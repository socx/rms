const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Admin users list', () => {
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

  test('admin can list users and non-admin is forbidden', async () => {
    const suffix = `${Date.now()%100000}-w${WORKER_ID}`;
    const u1 = `userA+${suffix}@example.com`;
    const u2 = `userB+${suffix}@example.com`;
    const adminEmail = `admin+${suffix}@example.com`;
    const pw = 'Password01';

    // Register two normal users
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'A', lastname: 'One', email: u1, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'B', lastname: 'Two', email: u2, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    // Register admin
    const r3 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'Sys', lastname: 'Admin', email: adminEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r3.status).toBe(201);

    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('No DATABASE_URL available for psql');

    // Promote admin and verify users using Prisma to avoid shelling out
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      expect(adminRec).toBeTruthy();
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      await prisma.user.updateMany({ where: { email: { in: [u1, u2] } }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
      const adminId = adminRec.id;
      const adminToken = jwt.sign({ sub: adminId, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
      // Use adminToken below
      var _adminToken = adminToken;
      // GET users as admin
      const g = await request(baseUrl).get('/api/v1/admin/users').set('Authorization', `Bearer ${_adminToken}`).set('Accept', 'application/json');
      expect(g.status).toBe(200);
      expect(g.body.success).toBe(true);
      expect(Array.isArray(g.body.data.users)).toBe(true);
      const emails = g.body.data.users.map(u => u.email);
      expect(emails).toEqual(expect.arrayContaining([u1, u2, adminEmail]));

      // Non-admin forbidden
      const userRec = await prisma.user.findUnique({ where: { email: u1 } });
      expect(userRec).toBeTruthy();
      const userToken = jwt.sign({ sub: userRec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
      const g2 = await request(baseUrl).get('/api/v1/admin/users').set('Authorization', `Bearer ${userToken}`).set('Accept', 'application/json');
      expect(g2.status).toBe(403);
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);
});
