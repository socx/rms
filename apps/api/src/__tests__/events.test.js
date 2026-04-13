const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Events API', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;
  let serverInfo;

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

  test('create -> get -> patch -> delete event flow', async () => {
    const suffix = `${Date.now()%100000}-w${WORKER_ID}`;
    const email = `evuser+${suffix}@example.com`;
    const pw = 'Password01';

    const r = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'E', lastname: 'User', email, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r.status).toBe(201);

    const conn = process.env.DATABASE_URL;

    // Verify user via Prisma so operations proceed
    const prisma = new PrismaClient();
    let userId;
    try {
      const rec = await prisma.user.findUnique({ where: { email } });
      expect(rec).toBeTruthy();
      userId = rec.id;
      await prisma.user.update({ where: { id: userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    } finally {
      await prisma.$disconnect();
    }
    const token = jwt.sign({ sub: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Create event
    const dt = new Date(Date.now() + 3600 * 1000).toISOString();
    const create = await request(baseUrl).post('/api/v1/events').set('Authorization', `Bearer ${token}`).send({ subject: 'Test Event', eventDatetime: dt, eventTimezone: 'UTC' }).set('Accept', 'application/json');
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;

    // Get event
    const g = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(g.status).toBe(200);
    expect(g.body.data.event).toHaveProperty('id', eventId);

    // Patch event
    const p = await request(baseUrl).patch(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).send({ subject: 'Updated Subject' }).set('Accept', 'application/json');
    expect(p.status).toBe(200);
    expect(p.body.data.event).toHaveProperty('subject', 'Updated Subject');

    // Delete (archive)
    const d = await request(baseUrl).delete(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(d.status).toBe(200);
    expect(d.body.data.event).toHaveProperty('status');

    // After archive, GET should return 404 for non-admin
    const g2 = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(g2.status).toBe(404);
  }, 30000);
});
