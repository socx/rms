const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

// Ensure test process has DATABASE_URL from repo root .env.dev when running from apps/api
let dbUrl = null;
try {
  const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, override: true });
    console.log('[test.setup] loaded env from', rootEnv);
  }
  try {
    const envRaw = fs.readFileSync(rootEnv, 'utf8');
    const m = envRaw.match(/^DATABASE_URL=(.*)$/m);
    if (m) dbUrl = m[1].trim();
    console.log('[test.setup] dbUrl read?', !!dbUrl);
  } catch (e) {}
} catch (e) {}

describe('regression: register -> verify -> login', () => {
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
    await stopServer(serverInfo);
  });

  test('full flow: register -> verify -> login', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `regtest+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Reg', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Wait briefly for outbox row to be created
    await new Promise(r => setTimeout(r, 500));

    // Query DB for the outbox body_html to extract the raw token
    const prisma = new PrismaClient();
    let html;
    try {
      const outboxRow = await prisma.emailOutbox.findFirst({ where: { to: email }, orderBy: { createdAt: 'desc' } });
      expect(outboxRow).not.toBeNull();
      html = (outboxRow.bodyHtml || '').trim();
    } finally {
      await prisma.$disconnect();
    }
    expect(html.length).toBeGreaterThan(0);

    const m = html.match(/verify-email\?token=([0-9a-fA-F]+)/);
    expect(m).not.toBeNull();
    const token = m[1];

    // Call verify endpoint
    const verify = await request(baseUrl).get('/api/v1/auth/verify-email').query({ token });
    expect([200,201]).toContain(verify.status);

    // Now login should succeed
    const login = await request(baseUrl).post('/api/v1/auth/login').send({ email, password: pw }).set('Accept', 'application/json');
    expect([200,201]).toContain(login.status);
    expect(login.body.success).toBe(true);
    expect(login.body.data).toHaveProperty('token');
  }, 30000);
});
