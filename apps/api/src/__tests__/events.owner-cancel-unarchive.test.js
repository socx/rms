const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Events: owner reassign, cancel, unarchive', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl;
  let serverInfo;

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });

  /** Bootstrap: register + verify user, return { token, userId } */
  async function setupUser(prisma, email, role = 'USER') {
    const pw = 'Password01';
    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'T', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    if (reg.status !== 201) throw new Error(`Register failed (${email}): ${reg.status}`);
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { systemRole: role, emailVerified: true, emailVerifiedAt: new Date() } });
    const token = jwt.sign({ sub: rec.id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { token, userId: rec.id };
  }

  async function createEvent(token, suffix) {
    const dt = new Date(Date.now() + 3600 * 1000).toISOString();
    const r = await request(baseUrl).post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: `Event ${suffix}`, eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(r.status).toBe(201);
    return r.body.data.event.id;
  }

  // ── PATCH /events/:id/owner ───────────────────────────────────────────

  test('owner can reassign event ownership', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eow-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eow-o+${suffix}@example.com`);
      const newOwner = await setupUser(prisma, `eow-n+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/owner`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ newOwnerId: newOwner.userId })
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(r.body.data.event.ownerId).toBe(newOwner.userId);

      // Old owner should now have CONTRIBUTOR access
      const access = await prisma.eventAccess.findUnique({
        where: { eventId_userId: { eventId, userId: owner.userId } },
      });
      expect(access).toBeTruthy();
      expect(String(access.role).toLowerCase()).toBe('contributor');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('reassign fails with 400 if target is already owner', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eowsame-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eowsame+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/owner`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ newOwnerId: owner.userId })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('ALREADY_OWNER');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('non-owner cannot reassign ownership', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eownp-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eownp-o+${suffix}@example.com`);
      const other = await setupUser(prisma, `eownp-x+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/owner`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ newOwnerId: other.userId })
        .set('Accept', 'application/json');
      expect(r.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  // ── POST /events/:id/cancel ───────────────────────────────────────────

  test('owner can cancel an event and reminders are also cancelled', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-ecanc-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `ecanc+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      // Add a reminder so we can verify it gets cancelled
      const remindAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const rem = await request(baseUrl).post(`/api/v1/events/${eventId}/reminders`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ remind_at: remindAt, subject_template: 'Remind {{subscriber_firstname}}', body_template: 'Hello {{subscriber_firstname}}', channels: ['email'] })
        .set('Accept', 'application/json');
      expect(rem.status).toBe(201);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(String(r.body.data.event.status).toLowerCase()).toBe('cancelled');

      // Reminder should also be cancelled
      const reminder = await prisma.reminder.findFirst({ where: { eventId } });
      expect(reminder).toBeTruthy();
      expect(String(reminder.status).toLowerCase()).toBe('cancelled');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('cancelling an already-cancelled event returns 400', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-ecanc2-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `ecanc2+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).post(`/api/v1/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('EVENT_NOT_ACTIVE');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('non-owner cannot cancel an event', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-ecancnp-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `ecancnp-o+${suffix}@example.com`);
      const other = await setupUser(prisma, `ecancnp-x+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${other.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  // ── POST /events/:id/unarchive ────────────────────────────────────────

  test('system_admin can unarchive an archived event', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eunarc-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eunarc-o+${suffix}@example.com`);
      const admin = await setupUser(prisma, `eunarc-a+${suffix}@example.com`, 'SYSTEM_ADMIN');
      const eventId = await createEvent(owner.token, suffix);

      // Archive it
      await request(baseUrl).delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/unarchive`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(String(r.body.data.event.status).toLowerCase()).toBe('active');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('non-admin cannot unarchive', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eunanp-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eunanp+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/unarchive`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('unarchiving an active event returns 400', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-eunaact-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `eunaact-o+${suffix}@example.com`);
      const admin = await setupUser(prisma, `eunaact-a+${suffix}@example.com`, 'SYSTEM_ADMIN');
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/unarchive`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('EVENT_NOT_ARCHIVED');
    } finally { await prisma.$disconnect(); }
  }, 30000);
});
