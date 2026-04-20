const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

describe('POST /users — admin create user', () => {
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

  test('admin can create a pre-verified user', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-cu-${WORKER_ID}`;
    const adminEmail = `admin-cu+${suffix}@example.com`;
    const newEmail   = `newuser+${suffix}@example.com`;
    const pw = 'Password01';

    // Register and promote an admin
    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Admin', lastname: 'CU', email: adminEmail, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      // Create user via POST /users
      const create = await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstname: 'New', lastname: 'User', email: newEmail, password: pw, timezone: 'Europe/London' })
        .set('Accept', 'application/json');
      expect(create.status).toBe(201);
      expect(create.body.success).toBe(true);
      const u = create.body.data.user;
      expect(u.email).toBe(newEmail);
      expect(u.emailVerified).toBe(true);
      expect(u.timezone).toBe('Europe/London');
      expect(String(u.systemRole).toLowerCase()).toBe('user');

      // Created user can log in immediately (no verification step needed)
      const login = await request(baseUrl).post('/api/v1/auth/login')
        .send({ email: newEmail, password: pw })
        .set('Accept', 'application/json');
      expect([200, 201]).toContain(login.status);
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  test('admin can create a user with system_admin role', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-cua-${WORKER_ID}`;
    const adminEmail = `admin-cua+${suffix}@example.com`;
    const newEmail   = `newadmin+${suffix}@example.com`;
    const pw = 'Password01';

    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Admin', lastname: 'CUA', email: adminEmail, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      const create = await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstname: 'Super', lastname: 'Admin', email: newEmail, password: pw, timezone: 'UTC', systemRole: 'SYSTEM_ADMIN' })
        .set('Accept', 'application/json');
      expect(create.status).toBe(201);
      expect(String(create.body.data.user.systemRole).toLowerCase()).toBe('system_admin');
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  test('non-admin cannot create a user', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-cun-${WORKER_ID}`;
    const normalEmail = `normal-cun+${suffix}@example.com`;
    const pw = 'Password01';

    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Normal', lastname: 'CUN', email: normalEmail, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    try {
      const rec = await prisma.user.findUnique({ where: { email: normalEmail } });
      await prisma.user.update({ where: { id: rec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
      const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      const create = await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'X', lastname: 'Y', email: `x+${suffix}@example.com`, password: pw, timezone: 'UTC' })
        .set('Accept', 'application/json');
      expect(create.status).toBe(403);
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  test('returns 409 when email already exists', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-cud-${WORKER_ID}`;
    const adminEmail = `admin-cud+${suffix}@example.com`;
    const dupEmail   = `dup+${suffix}@example.com`;
    const pw = 'Password01';

    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Admin', lastname: 'CUD', email: adminEmail, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      // Create once
      await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstname: 'Dup', lastname: 'One', email: dupEmail, password: pw, timezone: 'UTC' })
        .set('Accept', 'application/json');

      // Create again with same email
      const dup = await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstname: 'Dup', lastname: 'Two', email: dupEmail, password: pw, timezone: 'UTC' })
        .set('Accept', 'application/json');
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('EMAIL_EXISTS');
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  test('returns 400 for missing required fields', async () => {
    const prisma = new PrismaClient();
    const suffix = `${Date.now() % 100000}-cuv-${WORKER_ID}`;
    const adminEmail = `admin-cuv+${suffix}@example.com`;
    const pw = 'Password01';

    const reg = await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Admin', lastname: 'CUV', email: adminEmail, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    try {
      const adminRec = await prisma.user.findUnique({ where: { email: adminEmail } });
      await prisma.user.update({ where: { id: adminRec.id }, data: { systemRole: 'SYSTEM_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } });
      const adminToken = jwt.sign({ sub: adminRec.id, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

      // Missing password
      const r = await request(baseUrl).post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstname: 'X', lastname: 'Y', email: `missing+${suffix}@example.com` })
        .set('Accept', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);
});
