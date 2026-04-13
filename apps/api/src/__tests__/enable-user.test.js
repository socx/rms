const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Admin enable user', () => {
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

  test('admin can enable a disabled user', async () => {
    const suffix = `${Date.now()%100000}-w${WORKER_ID}`;
    const targetEmail = `enable-target+${suffix}@example.com`;
    const adminEmail = `enable-admin+${suffix}@example.com`;
    const pw = 'Password01';

    // Register target user
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'T', lastname: 'User', email: targetEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);

    // Register admin user
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'A', lastname: 'Admin', email: adminEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      expect(adminRec).toBeTruthy();
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      const targetRec = await prisma.user.findUnique({ where: { email: targetEmail } });
      expect(targetRec).toBeTruthy();
      const targetId = targetRec.id;

    // Disable target first
    const dis = await request(baseUrl).post(`/api/v1/users/${targetId}/disable`).set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(dis.status).toBe(200);

    // Enable target
    const en = await request(baseUrl).post(`/api/v1/users/${targetId}/enable`).set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(en.status).toBe(200);
    expect(en.body.success).toBe(true);
    expect(en.body.data.user).toHaveProperty('status');

    // Verify status is active
    const get = await request(baseUrl).get(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(get.status).toBe(200);
    const status = String(get.body.data.user.status).toLowerCase();
    expect(['active']).toContain(status);
    await prisma.$disconnect();
    } finally {
      try { await prisma.$disconnect(); } catch (e) {}
    }
  }, 30000);
});
