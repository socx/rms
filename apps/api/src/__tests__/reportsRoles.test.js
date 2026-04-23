/**
 * reportsRoles.test.js
 *
 * Role-scoped access tests for the Reminder Report endpoints.
 *
 * Coverage:
 *  GET /events/:id/reminders/:rid/report      — OWNER (200+reports); CONTRIBUTOR (200); READER (200);
 *                                               unauthenticated (401); no-access (403);
 *                                               non-existent reminder (404);
 *                                               pagination (per_page + total respected)
 *  GET /events/:id/reminders/:rid/report/:occ — OWNER (200); CONTRIBUTOR (200); READER (200);
 *                                               unauthenticated (401); invalid occ string (400);
 *                                               occ=0 (400); non-existent occ (404)
 */

const request            = require('supertest');
const path               = require('path');
const dotenv             = require('dotenv');
const fs                 = require('fs');
const jwt                = require('jsonwebtoken');
const { randomUUID }     = require('crypto');
const { PrismaClient }   = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Reminder Reports — role-scoped access', () => {
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

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `rptroles+${suffix}+w${WORKER_ID}@example.com`;
    const pw    = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Report', lastname: 'Roles', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: rec.id },
      data:  { emailVerified: true, emailVerifiedAt: new Date() },
    });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createEvent(token) {
    const dt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const r  = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Reports Roles Test Event', eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  async function createReminder(token, eventId) {
    const remindAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const r = await request(baseUrl)
      .post(`/api/v1/events/${eventId}/reminders`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        remind_at:        remindAt,
        subject_template: 'Report Test: {{event_subject}}',
        body_template:    '<p>Hi {{subscriber_firstname}}, reminder.</p>',
        channels:         ['email'],
      });
    return r.body.data.reminder.id;
  }

  async function grantRole(eventId, userId, grantedById, role) {
    await prisma.eventAccess.create({ data: { eventId, userId, role, grantedById } });
  }

  async function seedReport(reminderId, occurrenceNumber = 1, overrides = {}) {
    return prisma.reminderReport.create({
      data: {
        id:               randomUUID(),
        reminderId,
        occurrenceNumber,
        totalDispatches:  5,
        totalSent:        4,
        totalFailed:      1,
        totalSkipped:     0,
        failureDetails:   [{ channel: 'EMAIL', email: 'fail@example.com', reason: 'SMTP timeout' }],
        reportSentToOwner: false,
        ...overrides,
      },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl    = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ── GET /events/:id/reminders/:rid/report ─────────────────────────────────

  describe('GET /events/:id/reminders/:rid/report', () => {
    test('owner can list reports (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);
      await seedReport(rid, 1);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.reports)).toBe(true);
      expect(r.body.data.reports.length).toBe(1);
      expect(r.body.data.reports[0].occurrenceNumber).toBe(1);
      expect(r.body.data.reports[0].totalSent).toBe(4);
      expect(r.body.meta).toBeDefined();
      expect(r.body.meta.total).toBe(1);
    }, 30000);

    test('contributor can list reports (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-con`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(suffix + 'o');
      const { token: contribToken, userId: contribId } = await createVerifiedUser(suffix + 'c');
      const eid = await createEvent(ownerToken);
      await grantRole(eid, contribId, ownerId, 'CONTRIBUTOR');
      const rid = await createReminder(ownerToken, eid);
      await seedReport(rid, 1);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${contribToken}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.reports)).toBe(true);
      expect(r.body.data.reports.length).toBe(1);
    }, 30000);

    test('reader can list reports (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(suffix + 'o');
      const { token: readerToken, userId: readerId } = await createVerifiedUser(suffix + 'r');
      const eid = await createEvent(ownerToken);
      await grantRole(eid, readerId, ownerId, 'READER');
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${readerToken}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.reports)).toBe(true);
      expect(r.body.data.reports.length).toBe(0);
    }, 30000);

    test('unauthenticated returns 401', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-unauth`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`);

      expect(r.status).toBe(401);
    }, 30000);

    test('no-access user returns 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-noa`;
      const { token: ownerToken } = await createVerifiedUser(suffix + 'o');
      const { token: noToken }    = await createVerifiedUser(suffix + 'x');
      const eid = await createEvent(ownerToken);
      const rid = await createReminder(ownerToken, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report`)
        .set('Authorization', `Bearer ${noToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('non-existent reminder returns 404', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-norid`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/00000000-0000-0000-0000-000000000000/report`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 30000);

    test('per_page param limits results and total is accurate', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-pag`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);
      await seedReport(rid, 1);
      await seedReport(rid, 2);
      await seedReport(rid, 3);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report?per_page=2&page=1`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.reports.length).toBe(2);
      expect(r.body.meta.total).toBe(3);
      expect(r.body.meta.per_page).toBe(2);
      expect(r.body.meta.page).toBe(1);
    }, 30000);
  });

  // ── GET /events/:id/reminders/:rid/report/:occ ────────────────────────────

  describe('GET /events/:id/reminders/:rid/report/:occ', () => {
    test('owner gets single report by occurrence (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);
      await seedReport(rid, 2, { totalSent: 3, totalFailed: 0, failureDetails: null });

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/2`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.report.occurrenceNumber).toBe(2);
      expect(r.body.data.report.totalSent).toBe(3);
    }, 30000);

    test('contributor gets single report (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-con`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(suffix + 'o');
      const { token: contribToken, userId: contribId } = await createVerifiedUser(suffix + 'c');
      const eid = await createEvent(ownerToken);
      await grantRole(eid, contribId, ownerId, 'CONTRIBUTOR');
      const rid = await createReminder(ownerToken, eid);
      await seedReport(rid, 1);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/1`)
        .set('Authorization', `Bearer ${contribToken}`);

      expect(r.status).toBe(200);
      expect(r.body.data.report).toBeDefined();
    }, 30000);

    test('reader gets single report (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(suffix + 'o');
      const { token: readerToken, userId: readerId } = await createVerifiedUser(suffix + 'r');
      const eid = await createEvent(ownerToken);
      await grantRole(eid, readerId, ownerId, 'READER');
      const rid = await createReminder(ownerToken, eid);
      await seedReport(rid, 1);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/1`)
        .set('Authorization', `Bearer ${readerToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('unauthenticated returns 401', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-unauth`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);
      await seedReport(rid, 1);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/1`);

      expect(r.status).toBe(401);
    }, 30000);

    test('non-numeric occ returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-bad`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/abc`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(400);
    }, 30000);

    test('occ=0 returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-zero`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/0`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(400);
    }, 30000);

    test('non-existent occ returns 404', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-occ-none`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const rid = await createReminder(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/reminders/${rid}/report/99`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 30000);
  });
});
