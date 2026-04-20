const request = require('supertest');
const path    = require('path');
const dotenv  = require('dotenv');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Email Branding', () => {
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

  async function createVerifiedUser(suffix) {
    const email = `emailbrand+${suffix}@example.com`;
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Brand', lastname: 'Test', email, password: 'Password01', timezone: 'UTC' });
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createAdminUser(suffix) {
    const { userId, email } = await createVerifiedUser(suffix);
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SYSTEM_ADMIN' } });
    const token = jwt.sign({ sub: userId, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId, email, token };
  }

  // Valid HTML — must contain {{body}} placeholder
  const VALID_HTML = '<html><body>{{body}}</body></html>';

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ─── GET /users/:id/email-wrapper ─────────────────────────────────────────
  describe('GET /users/:id/email-wrapper', () => {

    test('returns 404 when no wrapper is configured', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-empty`);
      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 20000);

    test('returns 200 with emailWrapper after it has been set', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-set`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML, isActive: true });

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
      const w = r.body.data.emailWrapper;
      expect(w).toBeDefined();
      expect(w.wrapperHtml).toBe(VALID_HTML);
      expect(w.isActive).toBe(true);
      expect(w.id).toBeDefined();
    }, 20000);

    test('returns 401 when no token', async () => {
      const { userId } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-401`);
      const r = await request(baseUrl).get(`/api/v1/users/${userId}/email-wrapper`);
      expect(r.status).toBe(401);
    }, 20000);

    test('returns 403 when accessing another users wrapper', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-403a`);
      const { userId: uid2 }            = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-403b`);
      const r = await request(baseUrl)
        .get(`/api/v1/users/${uid2}/email-wrapper`)
        .set('Authorization', `Bearer ${t1}`);
      expect(r.status).toBe(403);
    }, 20000);

    test('admin can read any users wrapper', async () => {
      const { userId: uid, token: t } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-get-adm-sub`);
      const { token: adminToken } = await createAdminUser(`${Date.now() % 100000}-w${WORKER_ID}-get-adm`);
      await request(baseUrl)
        .put(`/api/v1/users/${uid}/email-wrapper`)
        .set('Authorization', `Bearer ${t}`)
        .send({ wrapperHtml: VALID_HTML });
      const r = await request(baseUrl)
        .get(`/api/v1/users/${uid}/email-wrapper`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(r.status).toBe(200);
      expect(r.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
    }, 20000);
  });

  // ─── PUT /users/:id/email-wrapper ─────────────────────────────────────────
  describe('PUT /users/:id/email-wrapper', () => {

    test('creates new wrapper and returns emailWrapper (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-create`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML, isActive: true });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      const w = r.body.data.emailWrapper;
      expect(w.wrapperHtml).toBe(VALID_HTML);
      expect(w.isActive).toBe(true);
      expect(w.id).toBeDefined();
    }, 20000);

    test('updates existing wrapper (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-update`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML });

      const updated = '<div class="brand">{{body}}</div>';
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: updated, isActive: false });

      expect(r.status).toBe(200);
      expect(r.body.data.emailWrapper.wrapperHtml).toBe(updated);
      expect(r.body.data.emailWrapper.isActive).toBe(false);
    }, 20000);

    test('defaults isActive to true when omitted', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-defactive`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML });
      expect(r.status).toBe(200);
      expect(r.body.data.emailWrapper.isActive).toBe(true);
    }, 20000);

    test('returns 400 when wrapperHtml is missing', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-noh`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: true });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('returns 400 when body placeholder is missing', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-noph`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: '<html><body>No placeholder</body></html>' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('MISSING_BODY_PLACEHOLDER');
    }, 20000);

    test('returns 401 when no token', async () => {
      const { userId } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-401`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .send({ wrapperHtml: VALID_HTML });
      expect(r.status).toBe(401);
    }, 20000);

    test('returns 403 when updating another users wrapper', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-403a`);
      const { userId: uid2 }            = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-403b`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${uid2}/email-wrapper`)
        .set('Authorization', `Bearer ${t1}`)
        .send({ wrapperHtml: VALID_HTML });
      expect(r.status).toBe(403);
    }, 20000);

    test('admin can set another users wrapper (200)', async () => {
      const { userId: uid } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put-adm-sub`);
      const { token: adminToken } = await createAdminUser(`${Date.now() % 100000}-w${WORKER_ID}-put-adm`);
      const r = await request(baseUrl)
        .put(`/api/v1/users/${uid}/email-wrapper`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ wrapperHtml: VALID_HTML });
      expect(r.status).toBe(200);
    }, 20000);
  });

  // ─── PATCH /users/:id/email-wrapper ───────────────────────────────────────
  describe('PATCH /users/:id/email-wrapper', () => {

    test('updates wrapperHtml only (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-patch-html`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML, isActive: true });

      const newHtml = '<html><head></head><body>{{body}}</body></html>';
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: newHtml });
      expect(r.status).toBe(200);
      expect(r.body.data.emailWrapper.wrapperHtml).toBe(newHtml);
      expect(r.body.data.emailWrapper.isActive).toBe(true);
    }, 20000);

    test('updates isActive only (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-patch-active`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML, isActive: true });

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });
      expect(r.status).toBe(200);
      expect(r.body.data.emailWrapper.isActive).toBe(false);
      expect(r.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
    }, 20000);

    test('returns 404 when no wrapper exists to patch', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-patch-404`);
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });
      expect(r.status).toBe(404);
    }, 20000);

    test('returns 400 when no valid fields provided', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-patch-empty`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML });
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('returns 401 when no token', async () => {
      const { userId } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-patch-401`);
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/email-wrapper`)
        .send({ isActive: false });
      expect(r.status).toBe(401);
    }, 20000);
  });

  // ─── DELETE /users/:id/email-wrapper ──────────────────────────────────────
  describe('DELETE /users/:id/email-wrapper', () => {

    test('deletes existing wrapper (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-ok`);
      await request(baseUrl)
        .put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML });

      const r = await request(baseUrl)
        .delete(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
      expect(r.body.data.message).toMatch(/removed/i);

      // Subsequent GET returns 404
      const check = await request(baseUrl)
        .get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`);
      expect(check.status).toBe(404);
    }, 20000);

    test('returns 404 when no wrapper configured', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-404`);
      const r = await request(baseUrl)
        .delete(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(404);
    }, 20000);

    test('returns 401 when no token', async () => {
      const { userId } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-401`);
      const r = await request(baseUrl)
        .delete(`/api/v1/users/${userId}/email-wrapper`);
      expect(r.status).toBe(401);
    }, 20000);

    test('returns 403 when deleting another users wrapper', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-403a`);
      const { userId: uid2, token: t2 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-403b`);
      await request(baseUrl)
        .put(`/api/v1/users/${uid2}/email-wrapper`)
        .set('Authorization', `Bearer ${t2}`)
        .send({ wrapperHtml: VALID_HTML });
      const r = await request(baseUrl)
        .delete(`/api/v1/users/${uid2}/email-wrapper`)
        .set('Authorization', `Bearer ${t1}`);
      expect(r.status).toBe(403);
    }, 20000);

    test('admin can delete any users wrapper (200)', async () => {
      const { userId: uid, token: t } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-del-adm-sub`);
      const { token: adminToken }     = await createAdminUser(`${Date.now() % 100000}-w${WORKER_ID}-del-adm`);
      await request(baseUrl)
        .put(`/api/v1/users/${uid}/email-wrapper`)
        .set('Authorization', `Bearer ${t}`)
        .send({ wrapperHtml: VALID_HTML });
      const r = await request(baseUrl)
        .delete(`/api/v1/users/${uid}/email-wrapper`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(r.status).toBe(200);
    }, 20000);
  });
});
