const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Events: access management (GET/POST/PATCH/DELETE /events/:id/access)', () => {
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

  async function setupUser(prisma, email, role = 'USER') {
    const pw = 'Password01';
    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'A', lastname: 'User', email, password: pw, timezone: 'UTC' })
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
      .send({ subject: `Access Event ${suffix}`, eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(r.status).toBe(201);
    return r.body.data.event.id;
  }

  // ── GET /events/:id/access ────────────────────────────────────────────

  test('owner can list access grants (empty initially)', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acl-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acl+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).get(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.grants)).toBe(true);
      expect(r.body.data.grants.length).toBe(0);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('non-owner cannot list access grants', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-aclnp-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `aclnp-o+${suffix}@example.com`);
      const other = await setupUser(prisma, `aclnp-x+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).get(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${other.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  // ── POST /events/:id/access ───────────────────────────────────────────

  test('owner can grant CONTRIBUTOR access to another user', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acg-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acg-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acg-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'CONTRIBUTOR' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(201);
      expect(r.body.success).toBe(true);
      const grant = r.body.data.grant;
      expect(grant.userId).toBe(target.userId);
      expect(String(grant.role).toLowerCase()).toBe('contributor');
      expect(grant.user.id).toBe(target.userId);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('owner can grant READER access to another user', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acgr-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acgr-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acgr-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'READER' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(201);
      expect(String(r.body.data.grant.role).toLowerCase()).toBe('reader');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('granted user now appears in GET access list', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acgl-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acgl-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acgl-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'READER' });

      const r = await request(baseUrl).get(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(r.body.data.grants.length).toBe(1);
      expect(r.body.data.grants[0].userId).toBe(target.userId);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('cannot grant access to the event owner (400)', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acgown-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acgown+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: owner.userId, role: 'CONTRIBUTOR' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('USER_IS_OWNER');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('granting access to already-granted user returns 409', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acdupg-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acdupg-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acdupg-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'READER' });

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'CONTRIBUTOR' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ACCESS_EXISTS');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('invalid role returns 400', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acbr-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acbr-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acbr-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'SUPERUSER' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_ROLE');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  // ── PATCH /events/:id/access/:uid ────────────────────────────────────

  test('owner can change a user role from READER to CONTRIBUTOR', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-ach-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `ach-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `ach-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'READER' });

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/access/${target.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'CONTRIBUTOR' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(String(r.body.data.grant.role).toLowerCase()).toBe('contributor');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('cannot change role for non-existent grant (404)', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-achnf-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `achnf-o+${suffix}@example.com`);
      const ghost = await setupUser(prisma, `achnf-g+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/access/${ghost.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'READER' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('cannot change event owner role via this endpoint (400)', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-achown-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `achown+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).patch(`/api/v1/events/${eventId}/access/${owner.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'READER' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('CANNOT_CHANGE_OWNER_ROLE');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  // ── DELETE /events/:id/access/:uid ───────────────────────────────────

  test('owner can revoke a user access grant', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acd-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acd-o+${suffix}@example.com`);
      const target = await setupUser(prisma, `acd-t+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      await request(baseUrl).post(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: target.userId, role: 'READER' });

      const r = await request(baseUrl).delete(`/api/v1/events/${eventId}/access/${target.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);

      // User should no longer appear in grants list
      const list = await request(baseUrl).get(`/api/v1/events/${eventId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      const ids = list.body.data.grants.map(g => g.userId);
      expect(ids).not.toContain(target.userId);

      // User should no longer be able to GET the event
      const get = await request(baseUrl).get(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${target.token}`)
        .set('Accept', 'application/json');
      expect(get.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('cannot revoke the event owner access (400)', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acdown-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acdown+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).delete(`/api/v1/events/${eventId}/access/${owner.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('CANNOT_REVOKE_OWNER');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('revoking non-existent grant returns 404', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-acdnf-${WORKER_ID}`;
    try {
      const owner = await setupUser(prisma, `acdnf-o+${suffix}@example.com`);
      const ghost = await setupUser(prisma, `acdnf-g+${suffix}@example.com`);
      const eventId = await createEvent(owner.token, suffix);

      const r = await request(baseUrl).delete(`/api/v1/events/${eventId}/access/${ghost.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);
});
