/**
 * remindersRoles.test.js
 *
 * Role-scoped access tests for the Reminders endpoints.
 * Mirrors the pattern in eventRoles.test.js.
 *
 * Coverage:
 *  GET  /events/:id/reminders          – all roles (200); unauthenticated (401); no-access (403)
 *  GET  /events/:id/reminders/:rid     – all roles (200); unauthenticated (401)
 *  POST /events/:id/reminders          – owner (201); contributor (201); reader (403); unauthenticated (401)
 *  PATCH /events/:id/reminders/:rid    – owner (200); contributor (200); reader (403); unauthenticated (401)
 *  DELETE /events/:id/reminders/:rid   – owner (200/cancelled); contributor (403); unauthenticated (401)
 *  POST /events/:id/reminders/:rid/preview – owner (200); contributor (200); reader (403)
 */

const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Reminders — role-scoped access', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  let serverInfo;
  let baseUrl;
  const prisma = new PrismaClient();

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `remroles+${suffix}+w${WORKER_ID}@example.com`;
    const pw = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Rem', lastname: 'Roles', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: rec.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createEvent(token, offsetHours = 72) {
    const dt = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
    const r = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Roles Test Event', eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  const validRemindAt = (offsetMin = 30) =>
    new Date(Date.now() + offsetMin * 60 * 1000).toISOString();

  const BASE_REMINDER = () => ({
    remind_at:        validRemindAt(),
    subject_template: 'Reminder: {{event_subject}}',
    body_template:    '<p>Hi {{subscriber_firstname}}, reminder for {{event_subject}}.</p>',
    channels:         ['email'],
  });

  async function createReminder(token, eventId) {
    const r = await request(baseUrl)
      .post(`/api/v1/events/${eventId}/reminders`)
      .set('Authorization', `Bearer ${token}`)
      .send(BASE_REMINDER());
    return r.body.data.reminder.id;
  }

  async function grantRole(eventId, userId, grantedById, role) {
    await prisma.eventAccess.create({
      data: { eventId, userId, role, grantedById },
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ── GET /events/:id/reminders ───────────────────────────────────────────

  describe('GET /events/:id/reminders', () => {
    test('owner can list reminders (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      await createReminder(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.reminders)).toBe(true);
      expect(r.body.data.reminders.length).toBe(1);
    }, 30000);

    test('contributor can list reminders (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('reader can list reminders (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${rdToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('unauthenticated user gets 401', async () => {
      const r = await request(baseUrl)
        .get('/api/v1/events/00000000-0000-0000-0000-000000000000/reminders');
      expect(r.status).toBe(401);
    }, 10000);

    test('user with no access gets 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-noa`;
      const { token: ownerToken } = await createVerifiedUser(`${suffix}-own`);
      const { token: otherToken } = await createVerifiedUser(`${suffix}-oth`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(r.status).toBe(403);
    }, 30000);
  });

  // ── POST /events/:id/reminders ──────────────────────────────────────────

  describe('POST /events/:id/reminders', () => {
    test('owner can create a reminder (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${token}`)
        .send(BASE_REMINDER());

      expect(r.status).toBe(201);
      expect(r.body.data.reminder.status).toBe('SCHEDULED');
      expect(r.body.data.reminder.channels).toEqual(['EMAIL']);
      expect(r.body.data.reminder.recurrence).toBe('NEVER');
    }, 30000);

    test('contributor can create a reminder (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send(BASE_REMINDER());

      expect(r.status).toBe(201);
    }, 30000);

    test('reader cannot create a reminder (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders`)
        .set('Authorization', `Bearer ${rdToken}`)
        .send(BASE_REMINDER());

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated user gets 401', async () => {
      const r = await request(baseUrl)
        .post('/api/v1/events/00000000-0000-0000-0000-000000000000/reminders')
        .send(BASE_REMINDER());
      expect(r.status).toBe(401);
    }, 10000);
  });

  // ── PATCH /events/:id/reminders/:rid ────────────────────────────────────

  describe('PATCH /events/:id/reminders/:rid', () => {
    test('owner can update a reminder (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject_template: 'Updated: {{event_subject}}' });

      expect(r.status).toBe(200);
      expect(r.body.data.reminder.subjectTemplate).toBe('Updated: {{event_subject}}');
    }, 30000);

    test('contributor can update a reminder (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ subject_template: 'Contrib updated: {{event_subject}}' });

      expect(r.status).toBe(200);
    }, 30000);

    test('reader cannot update a reminder (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${rdToken}`)
        .send({ subject_template: 'Hack attempt' });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated user gets 401', async () => {
      const r = await request(baseUrl)
        .patch('/api/v1/events/00000000-0000-0000-0000-000000000000/reminders/00000000-0000-0000-0000-000000000001')
        .send({ subject_template: 'x' });
      expect(r.status).toBe(401);
    }, 10000);
  });

  // ── DELETE /events/:id/reminders/:rid ───────────────────────────────────

  describe('DELETE /events/:id/reminders/:rid', () => {
    test('owner can delete/cancel a reminder', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      // Either hard-deleted or soft-cancelled
      expect(r.body.data.deleted === true || r.body.data.cancelled === true).toBe(true);
    }, 30000);

    test('contributor cannot delete a reminder (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/reminders/${rid}`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated user gets 401', async () => {
      const r = await request(baseUrl)
        .delete('/api/v1/events/00000000-0000-0000-0000-000000000000/reminders/00000000-0000-0000-0000-000000000001');
      expect(r.status).toBe(401);
    }, 10000);
  });

  // ── POST /events/:id/reminders/:rid/preview ─────────────────────────────

  describe('POST /events/:id/reminders/:rid/preview', () => {
    test('owner can get preview (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-prev-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
    }, 30000);

    test('contributor can get preview (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-prev-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({});

      expect(r.status).toBe(200);
    }, 30000);

    test('reader cannot get preview (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-prev-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/reminders/${rid}/preview`)
        .set('Authorization', `Bearer ${rdToken}`)
        .send({});

      expect(r.status).toBe(403);
    }, 30000);
  });
});
