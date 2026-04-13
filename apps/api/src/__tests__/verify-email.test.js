const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

// Load env like other tools/tests (look for repo root .env.dev)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
if (!process.env.DATABASE_URL) dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env.dev') });
const { PrismaClient } = require('@prisma/client');

describe('GET /auth/verify-email', () => {
  const prisma = new PrismaClient();
  let user;
  let rawToken;
  let serverProc;
  const baseUrl = 'http://localhost:3000';

  const waitForHealth = (url, timeout = 10000) => {
    const start = Date.now();
    const { URL } = require('url');
    const http = require('http');
    return new Promise((resolve, reject) => {
      const check = () => {
        const u = new URL(url + '/health');
        const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', timeout: 2000 }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            return resolve(true);
          }
          res.resume();
          if (Date.now() - start < timeout) return setTimeout(check, 200);
          return reject(new Error('Health check timeout'));
        });
        req.on('error', () => {
          if (Date.now() - start < timeout) return setTimeout(check, 200);
          return reject(new Error('Health check timeout'));
        });
        req.end();
      };
      check();
    });
  };

  beforeAll(async () => {
    const cp = require('child_process');
    const indexPath = require('path').resolve(__dirname, '..', 'index.js');
    serverProc = cp.spawn(process.execPath, [indexPath], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    serverProc.stdout.on('data', d => process.stdout.write('[api] '+d));
    serverProc.stderr.on('data', d => process.stderr.write('[api.err] '+d));
    await waitForHealth(baseUrl, 10000);
  });

  afterAll(async () => {
    try {
      if (user && user.id) {
        await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } catch (e) {
      // ignore cleanup errors
    }
    await prisma.$disconnect();
    if (serverProc) serverProc.kill();
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
