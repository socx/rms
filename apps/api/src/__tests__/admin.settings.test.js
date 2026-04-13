const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Admin settings API', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;
  let serverInfo;
  const { startServer, stopServer } = require('../test_helpers/server');

  // Load repo .env.dev
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

  test('system_admin can list and update settings; non-admin forbidden', async () => {
    const suffix = `${Date.now()%100000}-w${WORKER_ID}`;
    const adminEmail = `admin+${suffix}@example.com`;
    const userEmail = `user+${suffix}@example.com`;
    const pw = 'Password01';

    // Register normal user
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'U', lastname: 'User', email: userEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);

    // Register admin user
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'A', lastname: 'Admin', email: adminEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      const userRec = await prisma.user.findUnique({ where: { email: userEmail } });
      expect(adminRec).toBeTruthy();
      expect(userRec).toBeTruthy();
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      await prisma.user.update({ where: { id: userRec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      // GET settings as admin
      const g = await request(baseUrl).get('/api/v1/admin/settings').set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
      expect(g.status).toBe(200);
      expect(g.body.success).toBe(true);
      expect(Array.isArray(g.body.data.settings)).toBe(true);

      // Ensure there is a dispatch_poll_interval_seconds setting
      const found = g.body.data.settings.find(s => s.key === 'dispatch_poll_interval_seconds');
      expect(found).toBeDefined();

      // PATCH with valid value
      const pGood = await request(baseUrl).patch('/api/v1/admin/settings/dispatch_poll_interval_seconds').set('Authorization', `Bearer ${adminToken}`).send({ value: 20 }).set('Accept', 'application/json');
      expect(pGood.status).toBe(200);
      expect(pGood.body.success).toBe(true);
      expect(pGood.body.data.setting).toHaveProperty('value');
      expect(String(pGood.body.data.setting.value)).toBe('20');

      // PATCH with invalid (too small)
      const pBad = await request(baseUrl).patch('/api/v1/admin/settings/dispatch_poll_interval_seconds').set('Authorization', `Bearer ${adminToken}`).send({ value: 5 }).set('Accept', 'application/json');
      expect(pBad.status).toBe(400);

      // Non-admin attempt -> forbidden using userRec
      const userToken = jwt.sign({ sub: userRec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
      const g2 = await request(baseUrl).get('/api/v1/admin/settings').set('Authorization', `Bearer ${userToken}`).set('Accept', 'application/json');
      expect(g2.status).toBe(403);
    } finally {
      try { await prisma.$disconnect(); } catch (e) {}
    }
  }, 30000);
});
