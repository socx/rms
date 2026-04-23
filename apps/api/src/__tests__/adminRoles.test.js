/**
 * adminRoles.test.js
 *
 * Role-scoped access tests for the Admin endpoints.
 *
 * Coverage:
 *  GET  /admin/settings       — admin 200+shape; non-admin 403; unauthenticated 401
 *  PATCH /admin/settings/:key — admin 200+shape; non-admin 403; unauthenticated 401;
 *                               invalid value 400; setting not found 404
 *  GET  /admin/users          — admin 200+shape; non-admin 403; unauthenticated 401;
 *                               search filter returns subset
 *  GET  /admin/users/:id      — admin 200+shape; non-admin 403; unauthenticated 401;
 *                               not found 404
 *  PATCH /admin/users/:id     — admin disables user 200; admin promotes to admin 200;
 *                               non-admin 403; unauthenticated 401; self-modify 400;
 *                               user not found 404; invalid status 400; empty payload 400
 *  GET  /admin/events         — admin 200+shape+meta; non-admin 403; unauthenticated 401;
 *                               pagination meta correct; search filter returns subset
 */

const request          = require('supertest');
const path             = require('path');
const dotenv           = require('dotenv');
const fs               = require('fs');
const jwt              = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Admin — role-scoped access', () => {
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

  async function createVerifiedUser(suffix, { isAdmin = false } = {}) {
    const email = `adminroles+${suffix}+w${WORKER_ID}@example.com`;
    const pw    = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Admin', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: rec.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        ...(isAdmin ? { systemRole: 'SYSTEM_ADMIN' } : {}),
      },
    });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createEvent(token) {
    const dt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const r  = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Admin Test Event', eventDatetime: dt, eventTimezone: 'UTC' });
    return r.body.data.event.id;
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

  // ── GET /admin/settings ───────────────────────────────────────────────────

  describe('GET /admin/settings', () => {
    test('admin receives 200 with settings array', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gs-adm`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.settings)).toBe(true);
      expect(r.body.data.settings.length).toBeGreaterThan(0);
      expect(r.body.data.settings[0]).toHaveProperty('key');
      expect(r.body.data.settings[0]).toHaveProperty('value');
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gs-usr`;
      const { token } = await createVerifiedUser(suffix);

      const r = await request(baseUrl)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl).get('/api/v1/admin/settings');
      expect(r.status).toBe(401);
    }, 30000);
  });

  // ── PATCH /admin/settings/:key ────────────────────────────────────────────

  describe('PATCH /admin/settings/:key', () => {
    test('admin can update a setting (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ps-adm`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .patch('/api/v1/admin/settings/dispatch_retry_max')
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '5' });

      expect(r.status).toBe(200);
      expect(r.body.data.setting.key).toBe('dispatch_retry_max');
      expect(r.body.data.setting.value).toBe('5');
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ps-usr`;
      const { token } = await createVerifiedUser(suffix);

      const r = await request(baseUrl)
        .patch('/api/v1/admin/settings/dispatch_retry_max')
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '5' });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl)
        .patch('/api/v1/admin/settings/dispatch_retry_max')
        .send({ value: '5' });
      expect(r.status).toBe(401);
    }, 30000);

    test('invalid value for allow_public_registration returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ps-inv`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .patch('/api/v1/admin/settings/allow_public_registration')
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'yes' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_VALUE');
    }, 30000);

    test('non-existent setting key returns 404', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ps-nf`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .patch('/api/v1/admin/settings/no_such_key')
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '42' });

      expect(r.status).toBe(404);
    }, 30000);
  });

  // ── GET /admin/users ──────────────────────────────────────────────────────

  describe('GET /admin/users', () => {
    test('admin receives 200 with users array', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gu-adm`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.users)).toBe(true);
      expect(r.body.data.users[0]).toHaveProperty('id');
      expect(r.body.data.users[0]).toHaveProperty('email');
      expect(r.body.data.users[0]).toHaveProperty('systemRole');
      expect(r.body.data.users[0]).toHaveProperty('status');
    }, 30000);

    test('search by email returns matching users only', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gu-srch`;
      const { token, email } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .get('/api/v1/admin/users')
        .query({ q: email })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.users.every(u => u.email.includes('adminroles'))).toBe(true);
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gu-usr`;
      const { token } = await createVerifiedUser(suffix);

      const r = await request(baseUrl)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl).get('/api/v1/admin/users');
      expect(r.status).toBe(401);
    }, 30000);
  });

  // ── GET /admin/users/:id ──────────────────────────────────────────────────

  describe('GET /admin/users/:id', () => {
    test('admin can fetch a user by id (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gui-adm`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-gui-tgt`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .get(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.user.id).toBe(userId);
      expect(r.body.data.user).toHaveProperty('systemRole');
      expect(r.body.data.user).toHaveProperty('status');
      expect(r.body.data.user).toHaveProperty('emailVerified');
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix  = `${Date.now() % 1e6}-w${WORKER_ID}-gui-usr`;
      const { token } = await createVerifiedUser(suffix);
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-gui-tgt2`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .get(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl).get('/api/v1/admin/users/some-id');
      expect(r.status).toBe(401);
    }, 30000);

    test('non-existent user id returns 404', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-gui-nf`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .get('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 30000);
  });

  // ── PATCH /admin/users/:id ────────────────────────────────────────────────

  describe('PATCH /admin/users/:id', () => {
    test('admin can disable a user (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-dis`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-dis`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DISABLED' });

      expect(r.status).toBe(200);
      expect(r.body.data.user.status).toBe('DISABLED');
    }, 30000);

    test('admin can promote a user to SYSTEM_ADMIN (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-pro`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-pro`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ systemRole: 'SYSTEM_ADMIN' });

      expect(r.status).toBe(200);
      expect(String(r.body.data.user.systemRole).toLowerCase()).toBe('system_admin');
    }, 30000);

    test('admin can re-enable a disabled user (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-en`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-en`;
      const { userId } = await createVerifiedUser(suffix2);
      await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ACTIVE' });

      expect(r.status).toBe(200);
      expect(r.body.data.user.status).toBe('ACTIVE');
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix  = `${Date.now() % 1e6}-w${WORKER_ID}-pu-usr`;
      const { token } = await createVerifiedUser(suffix);
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-usr`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DISABLED' });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl)
        .patch('/api/v1/admin/users/some-id')
        .send({ status: 'DISABLED' });
      expect(r.status).toBe(401);
    }, 30000);

    test('admin modifying own account returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-self`;
      const { token, userId } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DISABLED' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('SELF_MODIFY');
    }, 30000);

    test('non-existent user returns 404', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-nf`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });

      const r = await request(baseUrl)
        .patch('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DISABLED' });

      expect(r.status).toBe(404);
    }, 30000);

    test('invalid status value returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-inv`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-inv`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELETED' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_STATUS');
    }, 30000);

    test('empty payload returns 400', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-pu-empty`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const suffix2   = `${Date.now() % 1e6}-w${WORKER_ID}-pu-tgt-empty`;
      const { userId } = await createVerifiedUser(suffix2);

      const r = await request(baseUrl)
        .patch(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 30000);
  });

  // ── GET /admin/events ─────────────────────────────────────────────────────

  describe('GET /admin/events', () => {
    test('admin receives 200 with events array and pagination meta', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ge-adm`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      await createEvent(token);

      const r = await request(baseUrl)
        .get('/api/v1/admin/events')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.events)).toBe(true);
      expect(r.body.data.events.length).toBeGreaterThan(0);
      expect(r.body.meta).toBeDefined();
      expect(r.body.meta).toHaveProperty('page');
      expect(r.body.meta).toHaveProperty('per_page');
      expect(r.body.meta).toHaveProperty('total');
    }, 30000);

    test('events include owner details', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ge-own`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      await createEvent(token);

      const r = await request(baseUrl)
        .get('/api/v1/admin/events')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      const ev = r.body.data.events[0];
      expect(ev.owner).toBeDefined();
      expect(ev.owner).toHaveProperty('id');
      expect(ev.owner).toHaveProperty('email');
      expect(ev.owner).toHaveProperty('firstname');
      expect(ev.owner).toHaveProperty('lastname');
    }, 30000);

    test('pagination per_page is respected', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ge-pg`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      await createEvent(token);
      await createEvent(token);

      const r = await request(baseUrl)
        .get('/api/v1/admin/events')
        .query({ page: 1, per_page: 1 })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.events.length).toBe(1);
      expect(r.body.meta.per_page).toBe(1);
      expect(r.body.meta.total).toBeGreaterThanOrEqual(2);
    }, 30000);

    test('search by subject returns matching events only', async () => {
      const suffix  = `${Date.now() % 1e6}-w${WORKER_ID}-ge-srch`;
      const { token } = await createVerifiedUser(suffix, { isAdmin: true });
      const dt       = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
      const unique   = `UniqueSubject-${Date.now()}`;
      await request(baseUrl)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: unique, eventDatetime: dt, eventTimezone: 'UTC' });

      const r = await request(baseUrl)
        .get('/api/v1/admin/events')
        .query({ q: unique })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.events.every(e => e.subject.includes(unique))).toBe(true);
    }, 30000);

    test('non-admin receives 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-ge-usr`;
      const { token } = await createVerifiedUser(suffix);

      const r = await request(baseUrl)
        .get('/api/v1/admin/events')
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated receives 401', async () => {
      const r = await request(baseUrl).get('/api/v1/admin/events');
      expect(r.status).toBe(401);
    }, 30000);
  });
});
