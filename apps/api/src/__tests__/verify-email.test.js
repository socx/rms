const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

// Load repo-level env for DATABASE_URL
try {
  const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
} catch (e) {}

describe('GET /auth/verify-email', () => {
  const prisma = new PrismaClient();
  let user;
  let rawToken;
  let serverInfo;
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    try {
      if (user && user.id) {
        await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } catch (e) {}
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  test('verifies email with valid token', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `verify+${unique}@example.com`;

    const passwordHash = await bcrypt.hash('Password01', 12);
    user = await prisma.user.create({ data: { firstname: 'V', lastname: 'User', email, passwordHash, timezone: 'UTC' } });

    rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt: expires } });

    const res = await request(baseUrl).get(`/api/v1/auth/verify-email`).query({ token: rawToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed.emailVerified).toBe(true);
  }, 20000);
});
