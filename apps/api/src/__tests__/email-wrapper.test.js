const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

describe('Email wrapper routes', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl;
  let serverInfo;
  const { startServer, stopServer } = require('../test_helpers/server');

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

  /** Helper: register a user, verify them directly in DB, return token + userId */
  async function createVerifiedUser(prisma, suffix, role = 'USER') {
    const email = `wrapper-${role.toLowerCase()}+${suffix}@example.com`;
    const pw = 'Password01';
    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'W', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    if (reg.status !== 201) throw new Error(`Register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { systemRole: role, emailVerified: true, emailVerifiedAt: new Date() } });
    const token = jwt.sign({ sub: rec.id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { token, userId: rec.id };
  }

  const VALID_HTML = '<html><body>{{body}}</body></html>';

  test('GET returns 404 when no wrapper exists yet', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wg1-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);
      const r = await request(baseUrl).get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PUT creates a wrapper and GET retrieves it', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wput-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);

      const put = await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');
      expect(put.status).toBe(200);
      expect(put.body.success).toBe(true);
      expect(put.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
      expect(put.body.data.emailWrapper.isActive).toBe(true);

      const get = await request(baseUrl).get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(get.status).toBe(200);
      expect(get.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PUT replaces an existing wrapper', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wputr-${WORKER_ID}`;
    const newHtml = '<html><body><div class="wrap">{{body}}</div></body></html>';
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);

      await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      const put2 = await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: newHtml })
        .set('Accept', 'application/json');
      expect(put2.status).toBe(200);
      expect(put2.body.data.emailWrapper.wrapperHtml).toBe(newHtml);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PUT returns 400 when wrapperHtml missing {{body}}', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wnob-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);
      const r = await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: '<html><body>no placeholder here</body></html>' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('MISSING_BODY_PLACEHOLDER');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PATCH updates isActive field', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wpatch-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);

      await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      const patch = await request(baseUrl).patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .set('Accept', 'application/json');
      expect(patch.status).toBe(200);
      expect(patch.body.data.emailWrapper.isActive).toBe(false);

      // wrapperHtml unchanged
      expect(patch.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PATCH returns 404 when no wrapper exists', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wpnf-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);
      const r = await request(baseUrl).patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .set('Accept', 'application/json');
      expect(r.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('PATCH returns 400 when no valid fields given', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wpempty-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);

      await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      const r = await request(baseUrl).patch(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ unknownField: 'x' })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('DELETE removes the wrapper and subsequent GET returns 404', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wdel-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);

      await request(baseUrl).put(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      const del = await request(baseUrl).delete(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const get = await request(baseUrl).get(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(get.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('DELETE returns 404 when no wrapper exists', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wdelnf-${WORKER_ID}`;
    try {
      const { token, userId } = await createVerifiedUser(prisma, suffix);
      const r = await request(baseUrl).delete(`/api/v1/users/${userId}/email-wrapper`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(r.status).toBe(404);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('another user cannot access or modify a different user wrapper', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wauth-${WORKER_ID}`;
    try {
      const owner = await createVerifiedUser(prisma, `o-${suffix}`);
      const other = await createVerifiedUser(prisma, `x-${suffix}`);

      // Owner creates wrapper
      await request(baseUrl).put(`/api/v1/users/${owner.userId}/email-wrapper`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      // Other user tries to GET it
      const g = await request(baseUrl).get(`/api/v1/users/${owner.userId}/email-wrapper`)
        .set('Authorization', `Bearer ${other.token}`)
        .set('Accept', 'application/json');
      expect(g.status).toBe(403);

      // Other user tries to DELETE it
      const d = await request(baseUrl).delete(`/api/v1/users/${owner.userId}/email-wrapper`)
        .set('Authorization', `Bearer ${other.token}`)
        .set('Accept', 'application/json');
      expect(d.status).toBe(403);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('admin can access any user wrapper', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-wadmin-${WORKER_ID}`;
    try {
      const owner = await createVerifiedUser(prisma, `o-${suffix}`);
      const admin = await createVerifiedUser(prisma, `a-${suffix}`, 'SYSTEM_ADMIN');

      await request(baseUrl).put(`/api/v1/users/${owner.userId}/email-wrapper`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ wrapperHtml: VALID_HTML })
        .set('Accept', 'application/json');

      const g = await request(baseUrl).get(`/api/v1/users/${owner.userId}/email-wrapper`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Accept', 'application/json');
      expect(g.status).toBe(200);
      expect(g.body.data.emailWrapper.wrapperHtml).toBe(VALID_HTML);
    } finally { await prisma.$disconnect(); }
  }, 30000);
});
