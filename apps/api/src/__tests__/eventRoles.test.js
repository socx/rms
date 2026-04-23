const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Event detail — role-scoped access (GET & PATCH)', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl;
  let serverInfo;
  let prisma;

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  beforeAll(async () => {
    serverInfo = await startServer(0, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
    prisma = new PrismaClient();
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `evdet+${suffix}+w${WORKER_ID}@example.com`;
    const pw = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Det', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: rec.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createEvent(token) {
    const dt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const r = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Detail Test Event', eventDatetime: dt, eventTimezone: 'UTC', location: 'Room A', description: 'Test desc' })
      .set('Accept', 'application/json');
    expect(r.status).toBe(201);
    return r.body.data.event.id;
  }

  async function grantAccess(ownerToken, eventId, userId, role) {
    const r = await request(baseUrl)
      .post(`/api/v1/events/${eventId}/access`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, role })
      .set('Accept', 'application/json');
    expect(r.status).toBe(201);
  }

  // ── GET /events/:id ───────────────────────────────────────────────────────

  test('owner can GET event and receives all fields', async () => {
    const suffix = `${Date.now() % 100000}a`;
    const owner = await createVerifiedUser(suffix);
    const eventId = await createEvent(owner.token);

    const r = await request(baseUrl)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Accept', 'application/json');

    expect(r.status).toBe(200);
    expect(r.body.data.event).toMatchObject({
      id:            eventId,
      subject:       'Detail Test Event',
      eventTimezone: 'UTC',
      location:      'Room A',
      description:   'Test desc',
      status:        'ACTIVE',
      ownerId:       owner.userId,
    });
  }, 30000);

  test('contributor can GET event (200)', async () => {
    const suffix = `${Date.now() % 100000}b`;
    const owner = await createVerifiedUser(suffix + 'o');
    const contrib = await createVerifiedUser(suffix + 'c');
    const eventId = await createEvent(owner.token);
    await grantAccess(owner.token, eventId, contrib.userId, 'CONTRIBUTOR');

    const r = await request(baseUrl)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${contrib.token}`)
      .set('Accept', 'application/json');

    expect(r.status).toBe(200);
    expect(r.body.data.event).toHaveProperty('id', eventId);
  }, 30000);

  test('reader can GET event (200)', async () => {
    const suffix = `${Date.now() % 100000}c`;
    const owner = await createVerifiedUser(suffix + 'o');
    const reader = await createVerifiedUser(suffix + 'r');
    const eventId = await createEvent(owner.token);
    await grantAccess(owner.token, eventId, reader.userId, 'READER');

    const r = await request(baseUrl)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${reader.token}`)
      .set('Accept', 'application/json');

    expect(r.status).toBe(200);
    expect(r.body.data.event).toHaveProperty('id', eventId);
  }, 30000);

  test('unauthenticated GET returns 401', async () => {
    const suffix = `${Date.now() % 100000}d`;
    const owner = await createVerifiedUser(suffix);
    const eventId = await createEvent(owner.token);

    const r = await request(baseUrl)
      .get(`/api/v1/events/${eventId}`)
      .set('Accept', 'application/json');

    expect(r.status).toBe(401);
  }, 30000);

  test('user with no access gets 403 for someone else\'s event', async () => {
    const suffix = `${Date.now() % 100000}e`;
    const owner = await createVerifiedUser(suffix + 'o');
    const other = await createVerifiedUser(suffix + 'x');
    const eventId = await createEvent(owner.token);

    const r = await request(baseUrl)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Accept', 'application/json');

    expect(r.status).toBe(403);
  }, 30000);

  // ── PATCH /events/:id ─────────────────────────────────────────────────────

  test('owner can PATCH event (200) and fields are updated', async () => {
    const suffix = `${Date.now() % 100000}f`;
    const owner = await createVerifiedUser(suffix);
    const eventId = await createEvent(owner.token);

    const r = await request(baseUrl)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        subject:       'Updated Subject',
        location:      'New Room',
        description:   'New description',
      })
      .set('Accept', 'application/json');

    expect(r.status).toBe(200);
    expect(r.body.data.event).toMatchObject({
      subject:     'Updated Subject',
      location:    'New Room',
      description: 'New description',
    });
  }, 30000);

  test('contributor can PATCH event (200) and fields are updated', async () => {
    const suffix = `${Date.now() % 100000}g`;
    const owner = await createVerifiedUser(suffix + 'o');
    const contrib = await createVerifiedUser(suffix + 'c');
    const eventId = await createEvent(owner.token);
    await grantAccess(owner.token, eventId, contrib.userId, 'CONTRIBUTOR');

    const r = await request(baseUrl)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${contrib.token}`)
      .send({ subject: 'Contributor Updated' })
      .set('Accept', 'application/json');

    expect(r.status).toBe(200);
    expect(r.body.data.event.subject).toBe('Contributor Updated');
  }, 30000);

  test('reader cannot PATCH event (403)', async () => {
    const suffix = `${Date.now() % 100000}h`;
    const owner = await createVerifiedUser(suffix + 'o');
    const reader = await createVerifiedUser(suffix + 'r');
    const eventId = await createEvent(owner.token);
    await grantAccess(owner.token, eventId, reader.userId, 'READER');

    const r = await request(baseUrl)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${reader.token}`)
      .send({ subject: 'Should Fail' })
      .set('Accept', 'application/json');

    expect(r.status).toBe(403);
  }, 30000);

  test('unauthenticated PATCH returns 401', async () => {
    const suffix = `${Date.now() % 100000}i`;
    const owner = await createVerifiedUser(suffix);
    const eventId = await createEvent(owner.token);

    const r = await request(baseUrl)
      .patch(`/api/v1/events/${eventId}`)
      .send({ subject: 'Should Fail' })
      .set('Accept', 'application/json');

    expect(r.status).toBe(401);
  }, 30000);

  test('PATCH on a non-existent event ID returns 403 (auth check before existence)', async () => {
    const suffix = `${Date.now() % 100000}j`;
    const owner = await createVerifiedUser(suffix);
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const r = await request(baseUrl)
      .patch(`/api/v1/events/${fakeId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ subject: 'Ghost event' })
      .set('Accept', 'application/json');

    expect(r.status).toBe(403);
  }, 30000);
});
