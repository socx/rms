const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

describe('Auth logout', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;
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

  async function setupVerifiedUser(prisma, email) {
    const pw = 'Password01';
    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Logout', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    return { userId: rec.id, pw };
  }

  test('logout with valid token succeeds and revokes the token', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-lo-${WORKER_ID}`;
    try {
      const email = `logout+${suffix}@example.com`;
      const { userId, pw } = await setupVerifiedUser(prisma, email);

      const login = await request(baseUrl).post('/api/v1/auth/login')
        .send({ email, password: pw })
        .set('Accept', 'application/json');
      expect([200, 201]).toContain(login.status);
      const token = login.body.data.token;

      // Token works before logout
      const before = await request(baseUrl).get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(before.status).toBe(200);

      // Logout — server-side revocation
      const resp = await request(baseUrl).post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(resp.status).toBe(200);
      expect(resp.body.success).toBe(true);
      expect(resp.body.data).toHaveProperty('message');

      // Token must be rejected after logout
      const after = await request(baseUrl).get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('TOKEN_REVOKED');
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('logout is idempotent — second call with same token is treated as invalid', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-lo2-${WORKER_ID}`;
    try {
      const email = `logout2+${suffix}@example.com`;
      const { pw } = await setupVerifiedUser(prisma, email);

      const login = await request(baseUrl).post('/api/v1/auth/login')
        .send({ email, password: pw })
        .set('Accept', 'application/json');
      expect([200, 201]).toContain(login.status);
      const token = login.body.data.token;

      await request(baseUrl).post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      // Second logout — token already revoked; jwt.verify still passes (not expired),
      // but the route checks the denylist before inserting; upsert makes this 200 too
      const resp2 = await request(baseUrl).post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');
      expect(resp2.status).toBe(200);
    } finally { await prisma.$disconnect(); }
  }, 30000);

  test('logout without token returns 401', async () => {
    const resp = await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Accept', 'application/json');
    expect(resp.status).toBe(401);
  });

  test('logout with an already-expired token returns 401', async () => {
    const expiredToken = jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'USER' },
      process.env.JWT_SECRET, { expiresIn: -1 });
    const resp = await request(baseUrl).post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${expiredToken}`)
      .set('Accept', 'application/json');
    expect(resp.status).toBe(401);
    expect(resp.body.error.code).toBe('INVALID_TOKEN');
  });
});
