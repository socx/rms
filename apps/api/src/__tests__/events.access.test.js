const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Events access control', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  let baseUrl;
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

  test('requireEventRole enforces access: only owner or granted roles can view', async () => {
    const suffix = `${Date.now() % 100000}-w${WORKER_ID}`;
    const ownerEmail = `owner+${suffix}@example.com`;
    const otherEmail = `other+${suffix}@example.com`;
    const pw = 'Password01';

    // Register owner and other user
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'Owner', lastname: 'One', email: ownerEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'Other', lastname: 'Two', email: otherEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    // Verify both users and get IDs via Prisma
    const prisma = new PrismaClient();
    let ownerId, otherId;
    try {
      const ownerRec = await prisma.user.findUnique({ where: { email: ownerEmail } });
      const otherRec = await prisma.user.findUnique({ where: { email: otherEmail } });
      expect(ownerRec).toBeTruthy();
      expect(otherRec).toBeTruthy();
      ownerId = ownerRec.id;
      otherId = otherRec.id;
      await prisma.user.updateMany({
        where: { email: { in: [ownerEmail, otherEmail] } },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      });
    } finally {
      await prisma.$disconnect();
    }

    const ownerToken = jwt.sign({ sub: ownerId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const otherToken = jwt.sign({ sub: otherId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Owner creates an event
    const dt = new Date(Date.now() + 3600 * 1000).toISOString();
    const create = await request(baseUrl).post('/api/v1/events').set('Authorization', `Bearer ${ownerToken}`).send({ subject: 'Owner Event', eventDatetime: dt, eventTimezone: 'UTC' }).set('Accept', 'application/json');
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;

    // Other user should be forbidden
    const g = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(g.status).toBe(403);

    // Grant reader access to other user via Prisma
    const prisma2 = new PrismaClient();
    try {
      await prisma2.eventAccess.create({
        data: { eventId, userId: otherId, role: 'READER', grantedById: ownerId },
      });
    } finally {
      await prisma2.$disconnect();
    }

    // Now other user can GET
    const g2 = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(g2.status).toBe(200);
  }, 30000);
});
