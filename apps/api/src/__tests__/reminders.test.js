const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Reminders API', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let serverInfo;
  let baseUrl;
  const prisma = new PrismaClient();

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  // Helpers ──────────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `remtest+${suffix}@example.com`;
    const pw = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Rem', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  /** Create event with eventDatetime far in the future (2 days out by default) */
  async function createEvent(token, offsetHours = 48) {
    const dt = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
    const r = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Test Event', eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  /** A valid remind_at: 10 minutes from now */
  const validRemindAt = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const BASE_REMINDER = () => ({
    remind_at:        validRemindAt(),
    subject_template: 'Reminder: {{event_subject}}',
    body_template:    '<p>Hi {{subscriber_firstname}}, reminder for {{event_subject}}.</p>',
    channels:         ['email'],
  });

  async function createReminder(token, eventId, overrides = {}) {
    const r = await request(baseUrl)
      .post(`/api/v1/events/${eventId}/reminders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BASE_REMINDER(), ...overrides });
    return r;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ─── POST /events/:id/reminders ───────────────────────────────────────────
  describe('POST /events/:id/reminders', () => {

    test('owner can create a reminder (201)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-cr`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid);

      expect(r.status).toBe(201);
      expect(r.body.success).toBe(true);
      const rem = r.body.data.reminder;
      expect(rem.eventId).toBe(eid);
      expect(rem.subjectTemplate).toBe('Reminder: {{event_subject}}');
      expect(rem.status).toBe('SCHEDULED');
      expect(rem.recurrence).toBe('NEVER');
      expect(rem.channels).toEqual(['EMAIL']);
    }, 25000);

    test('contributor can create a reminder (201)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-contrib`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: contribId, token: contribToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: contribId, role: 'CONTRIBUTOR', grantedById: ownerId },
      });

      const r = await createReminder(contribToken, eid);
      expect(r.status).toBe(201);
    }, 25000);

    test('reader cannot create a reminder (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const r = await createReminder(readerToken, eid);
      expect(r.status).toBe(403);
    }, 25000);

    test('returns 401 without auth', async () => {
      const r = await request(baseUrl)
        .post('/api/v1/events/00000000-0000-0000-0000-000000000000/reminders')
        .send(BASE_REMINDER());
      expect(r.status).toBe(401);
    }, 10000);

    test('returns 422 when required fields are missing', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-miss`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject_template: 'foo', body_template: 'bar' }); // missing remind_at + channels

      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('returns 422 for invalid channel value', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badch`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, { channels: ['fax'] });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('returns 422 for empty channels array', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-empty`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, { channels: [] });
      expect(r.status).toBe(422);
    }, 20000);

    test('returns 422 for invalid recurrence value', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badrec`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, { recurrence: 'minutely' });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('accepts all valid recurrence values', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-allrec`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const validValues = ['never', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'fortnightly', 'monthly', 'every_3_months', 'every_6_months', 'yearly'];

      for (const rec of validValues) {
        const rt = new Date(Date.now() + (15 + validValues.indexOf(rec)) * 60 * 1000).toISOString();
        const r = await createReminder(token, eid, { recurrence: rec, remind_at: rt });
        expect(r.status).toBe(201);
        expect(r.body.data.reminder.recurrence).toBe(rec.toUpperCase().replace(/-/g, '_'));
        // Clean up after each so we don't hit the limit
        await prisma.reminder.delete({ where: { id: r.body.data.reminder.id } });
      }
    }, 60000);

    test('returns 422 for unknown template variable in subject', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badvar-s`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, {
        subject_template: 'Hi {{unknown_var}}, see {{event_subject}}',
      });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_TEMPLATE');
    }, 20000);

    test('returns 422 for unknown template variable in body', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badvar-b`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, {
        body_template: '<p>{{subscriber_firstname}} — {{bad_variable}}</p>',
      });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_TEMPLATE');
    }, 20000);

    test('returns 422 for remind_at in the past', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-past`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const pastAt = new Date(Date.now() - 60 * 1000).toISOString();
      const r = await createReminder(token, eid, { remind_at: pastAt });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/5 minutes/i);
    }, 20000);

    test('returns 422 for remind_at less than 5 minutes in the future', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-soon`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const tooSoonAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min
      const r = await createReminder(token, eid, { remind_at: tooSoonAt });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/5 minutes/i);
    }, 20000);

    test('returns 422 when remind_at is at or after event_datetime', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-afterevt`;
      const { token } = await createVerifiedUser(suffix);
      // Event is only 8 minutes away
      const eid = await createEvent(token, 8 / 60); // 8 min from now

      // remind_at 10 min from now (after the 8-min event_datetime)
      const remindAfterEvent = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const r = await createReminder(token, eid, { remind_at: remindAfterEvent });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/before event_datetime/i);
    }, 20000);

    test('5-reminder limit: 5th creates OK, 6th returns 409', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-limit`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      for (let i = 0; i < 5; i++) {
        const rt = new Date(Date.now() + (10 + i * 5) * 60 * 1000).toISOString();
        const r = await createReminder(token, eid, { remind_at: rt });
        expect(r.status).toBe(201);
      }

      const rt6 = new Date(Date.now() + 50 * 60 * 1000).toISOString();
      const r6 = await createReminder(token, eid, { remind_at: rt6 });
      expect(r6.status).toBe(409);
      expect(r6.body.error.code).toBe('REMINDER_LIMIT_REACHED');
    }, 60000);

    test('returns 409 when event is cancelled', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-canc`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      // Cancel the event directly via Prisma
      await prisma.event.update({ where: { id: eid }, data: { status: 'CANCELLED' } });

      const r = await createReminder(token, eid);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('EVENT_NOT_ACTIVE');
    }, 20000);

    test('stores multi-channel (email + sms) correctly', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-multi`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, { channels: ['email', 'sms'] });
      expect(r.status).toBe(201);
      expect(r.body.data.reminder.channels).toEqual(expect.arrayContaining(['EMAIL', 'SMS']));
    }, 20000);

    test('stores recurrence correctly', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rec`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await createReminder(token, eid, { recurrence: 'daily' });
      expect(r.status).toBe(201);
      expect(r.body.data.reminder.recurrence).toBe('DAILY');
    }, 20000);
  });

  // ─── GET /events/:id/reminders ────────────────────────────────────────────
  describe('GET /events/:id/reminders', () => {

    test('lists reminders for event ordered by remindAt', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-list`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const rt1 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const rt2 = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      await createReminder(token, eid, { remind_at: rt1 });
      await createReminder(token, eid, { remind_at: rt2 });

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reminders.length).toBeGreaterThanOrEqual(2);
      const times = r.body.data.reminders.map(x => new Date(x.remindAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }, 30000);

    test('reader can list reminders', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdlist`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });
      await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${readerToken}`);
      expect(r.status).toBe(200);
    }, 25000);

    test('returns empty array when event has no reminders', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-empty`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
      expect(r.body.data.reminders).toEqual([]);
    }, 20000);
  });

  // ─── GET /events/:id/reminders/:rid ───────────────────────────────────────
  describe('GET /events/:id/reminders/:rid', () => {

    test('returns reminder detail', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-getone`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reminder.id).toBe(rid);
    }, 20000);

    test('returns 404 for unknown reminder id', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-unk`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 20000);

    test('returns 404 when reminder belongs to a different event', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-cross`;
      const { token } = await createVerifiedUser(suffix);
      const eid1 = await createEvent(token);
      const eid2 = await createEvent(token);

      const cr = await createReminder(token, eid1);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid2}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 25000);
  });

  // ─── PATCH /events/:id/reminders/:rid ─────────────────────────────────────
  describe('PATCH /events/:id/reminders/:rid', () => {

    test('updates subject_template and channels', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-upd`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const newSubject = 'Updated: {{event_subject}} — {{event_date}}';
      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject_template: newSubject, channels: ['email', 'sms'] });

      expect(r.status).toBe(200);
      expect(r.body.data.reminder.subjectTemplate).toBe(newSubject);
      expect(r.body.data.reminder.channels).toEqual(expect.arrayContaining(['EMAIL', 'SMS']));
    }, 25000);

    test('updates recurrence', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-uprec`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recurrence: 'weekly' });

      expect(r.status).toBe(200);
      expect(r.body.data.reminder.recurrence).toBe('WEEKLY');
    }, 20000);

    test('returns 400 when no updatable fields provided', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-nofld`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(r.status).toBe(400);
    }, 20000);

    test('returns 422 for unknown template variable in patch', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badsub`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject_template: '{{completely_wrong}} thing' });

      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_TEMPLATE');
    }, 20000);

    test('returns 422 for invalid recurrence value in patch', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badrec2`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recurrence: 'every_minute' });

      expect(r.status).toBe(422);
    }, 20000);

    test('blocked when status is RECURRING (409)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rec-blk`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      // Force status to RECURRING
      await prisma.reminder.update({ where: { id: rid }, data: { status: 'RECURRING' } });

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject_template: 'New {{event_subject}}' });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('REMINDER_NOT_EDITABLE');
    }, 20000);

    test('blocked when status is SENT (409)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-sent-blk`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      await prisma.reminder.update({ where: { id: rid }, data: { status: 'SENT' } });

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channels: ['sms'] });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('REMINDER_NOT_EDITABLE');
    }, 20000);

    test('blocked when status is CANCELLED (409)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-canc-blk`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      await prisma.reminder.update({ where: { id: rid }, data: { status: 'CANCELLED' } });

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channels: ['sms'] });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('REMINDER_NOT_EDITABLE');
    }, 20000);

    test('editable when status is FAILED', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-fail-ok`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      await prisma.reminder.update({ where: { id: rid }, data: { status: 'FAILED' } });

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channels: ['sms'] });

      expect(r.status).toBe(200);
    }, 20000);

    test('reader cannot patch (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdpatch`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({ channels: ['sms'] });
      expect(r.status).toBe(403);
    }, 25000);

    test('returns 404 for unknown reminder', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-p404`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channels: ['sms'] });
      expect(r.status).toBe(404);
    }, 20000);
  });

  // ─── DELETE /events/:id/reminders/:rid ────────────────────────────────────
  describe('DELETE /events/:id/reminders/:rid', () => {

    test('hard-deletes when no dispatch records exist', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-del`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.deleted).toBe(true);

      // Verify gone
      const g = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);
      expect(g.status).toBe(404);
    }, 25000);

    test('cancels instead of deleting when dispatch records exist', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-disp`;
      const { token, userId } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      // Create a subscriber and contact, then a dispatch record
      const sub = await prisma.subscriber.create({
        data: {
          eventId:   eid,
          firstname: 'Test',
          lastname:  'Dispatch',
          contacts:  {
            create: [{ channel: 'EMAIL', contactValue: `dispatch-${suffix}@example.com`, isPrimary: true }],
          },
        },
        include: { contacts: true },
      });
      const contactId = sub.contacts[0].id;

      await prisma.reminderDispatch.create({
        data: {
          reminderId:          rid,
          subscriberId:        sub.id,
          subscriberContactId: contactId,
          channel:             'EMAIL',
          renderedBody:        'test body',
        },
      });

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.cancelled).toBe(true);
      expect(r.body.data.reminder.status).toBe('CANCELLED');

      // Verify still exists but cancelled
      const g = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);
      expect(g.status).toBe(200);
      expect(g.body.data.reminder.status).toBe('CANCELLED');
    }, 25000);

    test('contributor cannot delete (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-ctdel`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: contribId, token: contribToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: contribId, role: 'CONTRIBUTOR', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${contribToken}`);
      expect(r.status).toBe(403);
    }, 25000);

    test('reader cannot delete (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rddel`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${readerToken}`);
      expect(r.status).toBe(403);
    }, 25000);

    test('returns 404 for unknown reminder', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-d404`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 20000);
  });

  // ─── POST /events/:id/reminders/:rid/preview ──────────────────────────────
  describe('POST /events/:id/reminders/:rid/preview', () => {

    test('returns sample data when no subscribers exist', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-sample`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      const p = r.body.data.preview;
      expect(p.preview_mode).toBe('sample');
      expect(p.subscriber_id).toBeNull();
      expect(p.subscriber_name).toBe('Sample Subscriber');
      expect(p.rendered_subject).toBeTruthy();
      expect(p.rendered_body_html).toBeTruthy();
      expect(p.rendered_body_plain).toBeTruthy();
      expect(typeof p.wrapper_applied).toBe('boolean');
      expect(typeof p.timezone_resolved).toBe('string');
    }, 25000);

    test('auto-selects first active subscriber when no subscriber_id given', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-auto`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      // Add a subscriber
      const subResp = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'Alice',
          lastname:  'Preview',
          contacts:  [{ channel: 'email', contact_value: `alice-prev-${suffix}@example.com` }],
        });
      const subId = subResp.body.data.subscriber.id;

      const cr = await createReminder(token, eid, {
        subject_template: 'Hi {{subscriber_firstname}} — {{event_subject}}',
        body_template:    '<p>Hello {{subscriber_fullname}}</p>',
      });
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      const p = r.body.data.preview;
      expect(p.preview_mode).toBe('real_subscriber');
      expect(p.subscriber_id).toBe(subId);
      expect(p.subscriber_name).toBe('Alice Preview');
      expect(p.rendered_subject).toContain('Alice');
    }, 25000);

    test('uses specified subscriber_id', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-spec`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      // Add two subscribers
      const sub1Resp = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'First', lastname: 'Sub', contacts: [{ channel: 'email', contact_value: `first-${suffix}@example.com` }] });
      const sub2Resp = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Second', lastname: 'Sub', contacts: [{ channel: 'email', contact_value: `second-${suffix}@example.com` }] });

      const sub2Id = sub2Resp.body.data.subscriber.id;

      const cr = await createReminder(token, eid, {
        subject_template: '{{subscriber_firstname}} {{subscriber_lastname}}',
        body_template:    '{{subscriber_fullname}}',
      });
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subscriber_id: sub2Id });

      expect(r.status).toBe(200);
      const p = r.body.data.preview;
      expect(p.preview_mode).toBe('real_subscriber');
      expect(p.subscriber_id).toBe(sub2Id);
      expect(p.subscriber_name).toBe('Second Sub');
      expect(p.rendered_subject).toBe('Second Sub');
    }, 30000);

    test('uses custom occurrence_number in rendered template', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-occ`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid, {
        subject_template: 'Occurrence {{occurrence_number}}',
        body_template:    'Occurrence {{occurrence_number}}',
      });
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ occurrence_number: 3 });

      expect(r.status).toBe(200);
      expect(r.body.data.preview.rendered_subject).toBe('Occurrence 3');
      expect(r.body.data.preview.occurrence_number).toBe(3);
    }, 25000);

    test('applies email wrapper when owner has one', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-wrap`;
      const { token, userId } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      // Create email wrapper for owner
      await prisma.emailWrapperSetting.upsert({
        where:  { ownerId: userId },
        create: { ownerId: userId, wrapperHtml: '<html><body>{{body}}</body></html>', isActive: true },
        update: { wrapperHtml: '<html><body>{{body}}</body></html>', isActive: true },
      });

      const cr = await createReminder(token, eid, {
        body_template: '<p>Inner content {{event_subject}}</p>',
      });
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      const p = r.body.data.preview;
      expect(p.wrapper_applied).toBe(true);
      expect(p.rendered_body_html).toContain('<html>');
      expect(p.rendered_body_html).toContain('Inner content');
    }, 25000);

    test('wrapper_applied is false when owner has no wrapper', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-nowrap`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      expect(r.body.data.preview.wrapper_applied).toBe(false);
    }, 25000);

    test('rendered_body_plain strips HTML tags', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-plain`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid, {
        body_template: '<p>Hello <strong>{{subscriber_firstname}}</strong>!</p>',
      });
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      const plain = r.body.data.preview.rendered_body_plain;
      expect(plain).not.toContain('<p>');
      expect(plain).not.toContain('<strong>');
      expect(plain).toContain('Hello');
    }, 25000);

    test('subscriber_id for different event is ignored (falls back to sample/first)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-cross`;
      const { token } = await createVerifiedUser(suffix);
      const eid1 = await createEvent(token);
      const eid2 = await createEvent(token);

      // Subscriber on event1
      const subResp = await request(baseUrl)
        .post(`/api/v1/events/${eid1}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'CrossEvent', lastname: 'Sub', contacts: [{ channel: 'email', contact_value: `cross-${suffix}@example.com` }] });
      const subId = subResp.body.data.subscriber.id;

      // Reminder on event2
      const cr = await createReminder(token, eid2);
      const rid = cr.body.data.reminder.id;

      // Pass subscriber from event1 to event2's reminder — should be ignored
      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid2}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subscriber_id: subId });

      expect(r.status).toBe(200);
      // subscriber not on event2, falls back to sample
      expect(r.body.data.preview.preview_mode).toBe('sample');
    }, 30000);

    test('reader cannot access preview (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({});
      expect(r.status).toBe(403);
    }, 25000);

    test('returns 404 for unknown reminder in preview', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-prev404`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/00000000-0000-0000-0000-000000000000/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(r.status).toBe(404);
    }, 20000);
  });

  // ─── GET /events/:id/reminders/:rid/report ────────────────────────────────
  describe('GET /events/:id/reminders/:rid/report', () => {

    test('returns empty list when no reports exist', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-empty`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reports).toEqual([]);
      expect(r.body.meta).toMatchObject({ page: 1, per_page: 20, total: 0 });
    }, 20000);

    test('lists reports ordered by occurrence_number with pagination', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-list`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      // Seed 3 reports directly via Prisma
      for (let occ = 1; occ <= 3; occ++) {
        await prisma.reminderReport.create({
          data: { reminderId: rid, occurrenceNumber: occ, totalDispatches: 5, totalSent: 4, totalFailed: 1, totalSkipped: 0 },
        });
      }

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reports).toHaveLength(3);
      expect(r.body.meta.total).toBe(3);
      const occs = r.body.data.reports.map(x => x.occurrenceNumber);
      expect(occs).toEqual([1, 2, 3]);
    }, 25000);

    test('reader can access reports', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${readerToken}`);
      expect(r.status).toBe(200);
    }, 25000);

    test('per_page pagination works', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-page`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      for (let occ = 1; occ <= 5; occ++) {
        await prisma.reminderReport.create({
          data: { reminderId: rid, occurrenceNumber: occ, totalDispatches: 2, totalSent: 2, totalFailed: 0, totalSkipped: 0 },
        });
      }

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report?page=2&per_page=2`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reports).toHaveLength(2);
      expect(r.body.meta).toMatchObject({ page: 2, per_page: 2, total: 5 });
    }, 25000);
  });

  // ─── GET /events/:id/reminders/:rid/report/:occ ────────────────────────────
  describe('GET /events/:id/reminders/:rid/report/:occ', () => {

    test('returns report for specific occurrence', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-occ`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      await prisma.reminderReport.create({
        data: { reminderId: rid, occurrenceNumber: 2, totalDispatches: 10, totalSent: 8, totalFailed: 2, totalSkipped: 0 },
      });

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/2`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      const rep = r.body.data.report;
      expect(rep.occurrenceNumber).toBe(2);
      expect(rep.totalDispatches).toBe(10);
      expect(rep.totalSent).toBe(8);
      expect(rep.totalFailed).toBe(2);
    }, 25000);

    test('returns 404 when no report for that occurrence', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-404`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const cr = await createReminder(token, eid);
      const rid = cr.body.data.reminder.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/99`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 20000);

    test('reader can access specific occurrence report', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rep-occ-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId: eid, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const cr = await createReminder(ownerToken, eid);
      const rid = cr.body.data.reminder.id;

      await prisma.reminderReport.create({
        data: { reminderId: rid, occurrenceNumber: 1, totalDispatches: 3, totalSent: 3, totalFailed: 0, totalSkipped: 0 },
      });

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/1`)
        .set('Authorization', `Bearer ${readerToken}`);
      expect(r.status).toBe(200);
    }, 25000);
  });
});
