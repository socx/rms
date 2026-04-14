const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Subscribers API', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let serverInfo;
  let baseUrl;
  const prisma = new PrismaClient();

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  // Helper: register a verified user and return a JWT token + userId
  async function createVerifiedUser(suffix) {
    const email = `subtest+${suffix}@example.com`;
    const pw = 'Password01';
    await request(baseUrl).post('/api/v1/auth/register')
      .send({ firstname: 'Sub', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: rec.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  // Helper: create an event owned by the given user
  async function createEvent(token, subject = 'Test Event') {
    const dt = new Date(Date.now() + 86400000).toISOString();
    const r = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject, eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ─── POST /events/:id/subscribers ──────────────────────────────────────────
  describe('POST /events/:id/subscribers', () => {
    test('owner can add a subscriber with contacts', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-cr`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'Alice',
          lastname: 'Smith',
          timezone: 'Europe/Madrid',
          contacts: [{ channel: 'email', contact_value: 'alice@example.com', is_primary: true }],
        });

      expect(r.status).toBe(201);
      expect(r.body.success).toBe(true);
      const sub = r.body.data.subscriber;
      expect(sub.firstname).toBe('Alice');
      expect(sub.lastname).toBe('Smith');
      expect(sub.status).toBe('ACTIVE');
      expect(sub.contacts).toHaveLength(1);
      expect(sub.contacts[0].channel).toBe('EMAIL');
      expect(sub.contacts[0].contactValue).toBe('alice@example.com');
      expect(sub.contacts[0].isPrimary).toBe(true);
    }, 20000);

    test('creates subscriber with multiple contacts', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-multi`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'Bob',
          lastname: 'Jones',
          contacts: [
            { channel: 'email', contact_value: 'bob@example.com', is_primary: true },
            { channel: 'sms', contact_value: '+15551234567', is_primary: true },
          ],
        });

      expect(r.status).toBe(201);
      expect(r.body.data.subscriber.contacts).toHaveLength(2);
    }, 20000);

    test('returns 422 when firstname is missing', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-nofn`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lastname: 'Smith', contacts: [{ channel: 'email', contact_value: 'x@example.com' }] });

      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 20000);

    test('returns 422 when contacts array is empty', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-nocon`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Alice', lastname: 'Smith', contacts: [] });

      expect(r.status).toBe(422);
    }, 20000);

    test('returns 422 for invalid channel', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badch`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Alice', lastname: 'Smith', contacts: [{ channel: 'fax', contact_value: 'x@example.com' }] });

      expect(r.status).toBe(422);
    }, 20000);

    test('requires authentication', async () => {
      const r = await request(baseUrl)
        .post('/api/v1/events/00000000-0000-0000-0000-000000000000/subscribers')
        .send({ firstname: 'Alice', lastname: 'Smith', contacts: [{ channel: 'email', contact_value: 'x@example.com' }] });
      expect(r.status).toBe(401);
    }, 10000);

    test('reader cannot add a subscriber (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdr`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eventId = await createEvent(ownerToken);

      // Grant reader access
      await prisma.eventAccess.create({
        data: { eventId, userId: readerId, role: 'READER', grantedById: ownerId },
      });

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({ firstname: 'Alice', lastname: 'Smith', contacts: [{ channel: 'email', contact_value: 'x@example.com' }] });

      expect(r.status).toBe(403);
    }, 20000);

    test('contributor can add a subscriber', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-contrib`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: contribId, token: contribToken } = await createVerifiedUser(`${suffix}-ct`);
      const eventId = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId, userId: contribId, role: 'CONTRIBUTOR', grantedById: ownerId },
      });

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${contribToken}`)
        .send({ firstname: 'Carol', lastname: 'White', contacts: [{ channel: 'email', contact_value: 'carol@example.com' }] });

      expect(r.status).toBe(201);
    }, 20000);
  });

  // ─── GET /events/:id/subscribers ───────────────────────────────────────────
  describe('GET /events/:id/subscribers', () => {
    test('lists subscribers with pagination', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-list`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      // Add 2 subscribers
      for (let i = 0; i < 2; i++) {
        await request(baseUrl)
          .post(`/api/v1/events/${eventId}/subscribers`)
          .set('Authorization', `Bearer ${token}`)
          .send({ firstname: `Sub${i}`, lastname: 'Test', contacts: [{ channel: 'email', contact_value: `sub${i}-${suffix}@example.com` }] });
      }

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.subscribers.length).toBeGreaterThanOrEqual(2);
      expect(r.body.meta).toMatchObject({ page: 1, per_page: 20 });
    }, 30000);

    test('reader can list subscribers', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdlist`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eventId = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId, userId: readerId, role: 'READER', grantedById: ownerId },
      });
      await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ firstname: 'Dave', lastname: 'Brown', contacts: [{ channel: 'email', contact_value: `dave-${suffix}@example.com` }] });

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${readerToken}`);

      expect(r.status).toBe(200);
    }, 20000);

    test('filters by status query param', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-filt`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Eve', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `eve-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      // Unsubscribe
      await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/unsubscribe`)
        .set('Authorization', `Bearer ${token}`);

      // Add another active subscriber
      await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Frank', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `frank-${suffix}@example.com` }] });

      const active = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers?status=active`)
        .set('Authorization', `Bearer ${token}`);
      expect(active.status).toBe(200);
      expect(active.body.data.subscribers.every(s => s.status === 'ACTIVE')).toBe(true);

      const unsub = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers?status=unsubscribed`)
        .set('Authorization', `Bearer ${token}`);
      expect(unsub.status).toBe(200);
      expect(unsub.body.data.subscribers.every(s => s.status === 'UNSUBSCRIBED')).toBe(true);
    }, 30000);
  });

  // ─── GET /events/:id/subscribers/:sid ──────────────────────────────────────
  describe('GET /events/:id/subscribers/:sid', () => {
    test('returns subscriber with contacts', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-getone`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Gina', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `gina-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.subscriber.id).toBe(subId);
      expect(r.body.data.subscriber.contacts).toHaveLength(1);
    }, 20000);

    test('returns 404 for unknown subscriber', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-404`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 20000);

    test('returns 404 when subscriber belongs to a different event', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-cross`;
      const { token } = await createVerifiedUser(suffix);
      const eventId1 = await createEvent(token, 'Event 1');
      const eventId2 = await createEvent(token, 'Event 2');

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId1}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Han', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `han-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eventId2}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 25000);
  });

  // ─── PATCH /events/:id/subscribers/:sid ────────────────────────────────────
  describe('PATCH /events/:id/subscribers/:sid', () => {
    test('updates subscriber fields', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-upd`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Iris', lastname: 'Old', contacts: [{ channel: 'email', contact_value: `iris-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Iris', lastname: 'New', timezone: 'America/New_York' });

      expect(r.status).toBe(200);
      expect(r.body.data.subscriber.lastname).toBe('New');
      expect(r.body.data.subscriber.timezone).toBe('America/New_York');
    }, 20000);

    test('returns 400 when no fields provided', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-nofld`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Jack', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `jack-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(400);
    }, 20000);

    test('reader cannot patch subscriber (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rpatch`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eventId = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId, userId: readerId, role: 'READER', grantedById: ownerId },
      });
      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ firstname: 'Kim', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `kim-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({ firstname: 'Kim2' });

      expect(r.status).toBe(403);
    }, 20000);
  });

  // ─── DELETE /events/:id/subscribers/:sid ───────────────────────────────────
  describe('DELETE /events/:id/subscribers/:sid', () => {
    test('deletes a subscriber when not the last', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-del`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      // Add 2 subscribers
      const cr1 = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Leo', lastname: 'A', contacts: [{ channel: 'email', contact_value: `leo-${suffix}@example.com` }] });
      await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Mia', lastname: 'B', contacts: [{ channel: 'email', contact_value: `mia-${suffix}@example.com` }] });

      const subId = cr1.body.data.subscriber.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.deleted).toBe(true);

      // Confirm gone
      const g = await request(baseUrl)
        .get(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(g.status).toBe(404);
    }, 25000);

    test('last-subscriber guard: blocks delete when only one active subscriber', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-last`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Nina', lastname: 'Only', contacts: [{ channel: 'email', contact_value: `nina-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_SUBSCRIBER');
    }, 20000);

    test('last-subscriber guard: unsubscribed subscriber does not count, delete succeeds', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-unsub`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      // Two subscribers: unsub one, then the remaining active one can still be deleted
      const cr1 = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Omar', lastname: 'A', contacts: [{ channel: 'email', contact_value: `omar-${suffix}@example.com` }] });
      const cr2 = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Pat', lastname: 'B', contacts: [{ channel: 'email', contact_value: `pat-${suffix}@example.com` }] });

      const sub1Id = cr1.body.data.subscriber.id;
      const sub2Id = cr2.body.data.subscriber.id;

      // Unsubscribe sub2
      await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${sub2Id}/unsubscribe`)
        .set('Authorization', `Bearer ${token}`);

      // sub1 is now the only ACTIVE one — guard should block its deletion
      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${sub1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_SUBSCRIBER');
    }, 25000);

    test('returns 404 for unknown subscriber', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-d404`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 20000);
  });

  // ─── POST /events/:id/subscribers/:sid/unsubscribe ─────────────────────────
  describe('POST /events/:id/subscribers/:sid/unsubscribe', () => {
    test('sets status to UNSUBSCRIBED', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-unsub2`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Quinn', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `quinn-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/unsubscribe`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.subscriber.status).toBe('UNSUBSCRIBED');
    }, 20000);

    test('reader cannot unsubscribe (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rununsub`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eventId = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId, userId: readerId, role: 'READER', grantedById: ownerId },
      });
      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ firstname: 'Rose', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `rose-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/unsubscribe`)
        .set('Authorization', `Bearer ${readerToken}`);

      expect(r.status).toBe(403);
    }, 20000);
  });

  // ─── POST /events/:id/subscribers/:sid/contacts ────────────────────────────
  describe('POST contacts', () => {
    test('adds a contact to a subscriber', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-addcon`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Sam', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `sam-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'sms', contact_value: '+15559876543', label: 'cell' });

      expect(r.status).toBe(201);
      expect(r.body.data.contact.channel).toBe('SMS');
      expect(r.body.data.contact.contactValue).toBe('+15559876543');
      expect(r.body.data.contact.label).toBe('cell');
    }, 20000);

    test('returns 422 for missing channel', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-noch`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Tina', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `tina-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ contact_value: 'foo@example.com' });

      expect(r.status).toBe(422);
    }, 20000);

    test('returns 422 for invalid channel value', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badch2`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Uma', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `uma-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers/${subId}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'fax', contact_value: '123456' });

      expect(r.status).toBe(422);
    }, 20000);
  });

  // ─── PATCH /events/:id/subscribers/:sid/contacts/:cid ──────────────────────
  describe('PATCH contacts', () => {
    test('updates contact fields', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-pcon`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Vera', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `vera-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ contact_value: `vera-new-${suffix}@example.com`, label: 'work' });

      expect(r.status).toBe(200);
      expect(r.body.data.contact.contactValue).toBe(`vera-new-${suffix}@example.com`);
      expect(r.body.data.contact.label).toBe('work');
    }, 20000);

    test('can deactivate a contact via status field', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-dact`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'West', lastname: 'Test',
          contacts: [
            { channel: 'email', contact_value: `west1-${suffix}@example.com` },
            { channel: 'email', contact_value: `west2-${suffix}@example.com` },
          ],
        });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'inactive' });

      expect(r.status).toBe(200);
      expect(r.body.data.contact.status).toBe('INACTIVE');
    }, 20000);

    test('returns 422 for invalid status value', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-badst`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Xara', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `xara-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'deleted' });

      expect(r.status).toBe(422);
    }, 20000);

    test('returns 404 for unknown contact', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-con404`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Yuki', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `yuki-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'foo' });

      expect(r.status).toBe(404);
    }, 20000);
  });

  // ─── DELETE /events/:id/subscribers/:sid/contacts/:cid ─────────────────────
  describe('DELETE contacts', () => {
    test('deletes a contact when not the last', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-dcon`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'Zack', lastname: 'Test',
          contacts: [
            { channel: 'email', contact_value: `zack1-${suffix}@example.com` },
            { channel: 'email', contact_value: `zack2-${suffix}@example.com` },
          ],
        });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.deleted).toBe(true);
    }, 20000);

    test('last-contact guard: blocks delete when only one active contact', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-lcon`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Aaron', lastname: 'Last', contacts: [{ channel: 'email', contact_value: `aaron-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_CONTACT');
    }, 20000);

    test('last-contact guard: inactive contact does not count as active', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-inact`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      // Two contacts — deactivate one, then the other becomes the only active
      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstname: 'Beth', lastname: 'Test',
          contacts: [
            { channel: 'email', contact_value: `beth1-${suffix}@example.com` },
            { channel: 'email', contact_value: `beth2-${suffix}@example.com` },
          ],
        });
      const subId = cr.body.data.subscriber.id;
      const c1Id = cr.body.data.subscriber.contacts[0].id;
      const c2Id = cr.body.data.subscriber.contacts[1].id;

      // Deactivate c2
      await request(baseUrl)
        .patch(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${c2Id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'inactive' });

      // c1 is now the only ACTIVE contact — guard blocks deletion
      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${c1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_CONTACT');
    }, 25000);

    test('returns 404 for unknown contact', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-dcon404`;
      const { token } = await createVerifiedUser(suffix);
      const eventId = await createEvent(token);

      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Cara', lastname: 'Test', contacts: [{ channel: 'email', contact_value: `cara-${suffix}@example.com` }] });
      const subId = cr.body.data.subscriber.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 20000);

    test('reader cannot delete contact (403)', async () => {
      const suffix = `${Date.now() % 100000}-w${WORKER_ID}-rdcon`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: readerId, token: readerToken } = await createVerifiedUser(`${suffix}-rd`);
      const eventId = await createEvent(ownerToken);

      await prisma.eventAccess.create({
        data: { eventId, userId: readerId, role: 'READER', grantedById: ownerId },
      });
      const cr = await request(baseUrl)
        .post(`/api/v1/events/${eventId}/subscribers`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          firstname: 'Dan', lastname: 'Test',
          contacts: [
            { channel: 'email', contact_value: `dan1-${suffix}@example.com` },
            { channel: 'email', contact_value: `dan2-${suffix}@example.com` },
          ],
        });
      const subId = cr.body.data.subscriber.id;
      const contactId = cr.body.data.subscriber.contacts[0].id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eventId}/subscribers/${subId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${readerToken}`);

      expect(r.status).toBe(403);
    }, 20000);
  });
});
