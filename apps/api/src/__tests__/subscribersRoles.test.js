/**
 * subscribersRoles.test.js
 *
 * Role-scoped access tests for the Subscribers endpoints.
 * Mirrors the pattern in remindersRoles.test.js / eventRoles.test.js.
 *
 * Coverage:
 *  GET  /events/:id/subscribers              — OWNER, CONTRIBUTOR, READER (200); unauthenticated (401); no-access (403)
 *  POST /events/:id/subscribers              — OWNER (201); CONTRIBUTOR (201); READER (403); unauthenticated (401); invalid body (422)
 *  PATCH /events/:id/subscribers/:sid        — OWNER (200); CONTRIBUTOR (200); READER (403); unauthenticated (401)
 *  DELETE /events/:id/subscribers/:sid       — OWNER (200); CONTRIBUTOR (200); READER (403); unauthenticated (401)
 *  POST /events/:id/subscribers/:sid/unsubscribe — OWNER (200); CONTRIBUTOR (200); READER (403)
 *  POST /events/:id/subscribers/:sid/contacts    — OWNER (201); CONTRIBUTOR (201)
 *  PATCH /events/:id/subscribers/:sid/contacts/:cid — OWNER (200); isPrimary flag update
 *  DELETE /events/:id/subscribers/:sid/contacts/:cid — OWNER (200); last-contact guard (409)
 */

const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Subscribers — role-scoped access', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  let serverInfo;
  let baseUrl;
  const prisma = new PrismaClient();

  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `subroles+${suffix}+w${WORKER_ID}@example.com`;
    const pw = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Sub', lastname: 'Roles', email, password: pw, timezone: 'UTC' })
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
    const dt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const r = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Sub Roles Test Event', eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  const BASE_SUBSCRIBER = () => ({
    firstname: 'Alice',
    lastname:  'Test',
    timezone:  'UTC',
    contacts: [{ channel: 'email', contact_value: `alice+${Date.now()}@example.com`, is_primary: true }],
  });

  async function createSubscriber(token, eventId) {
    const r = await request(baseUrl)
      .post(`/api/v1/events/${eventId}/subscribers`)
      .set('Authorization', `Bearer ${token}`)
      .send(BASE_SUBSCRIBER());
    return r.body.data.subscriber;
  }

  async function grantRole(eventId, userId, grantedById, role) {
    await prisma.eventAccess.create({ data: { eventId, userId, role, grantedById } });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ── GET /events/:id/subscribers ─────────────────────────────────────────

  describe('GET /events/:id/subscribers', () => {
    test('owner can list subscribers (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.subscribers)).toBe(true);
      expect(r.body.data.subscribers.length).toBe(1);
    }, 30000);

    test('contributor can list subscribers (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('reader can list subscribers (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${rdToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('unauthenticated request returns 401', async () => {
      const r = await request(baseUrl)
        .get('/api/v1/events/00000000-0000-0000-0000-000000000000/subscribers');
      expect(r.status).toBe(401);
    }, 10000);

    test('user with no access returns 403', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lst-noa`;
      const { token: ownerToken } = await createVerifiedUser(`${suffix}-own`);
      const { token: otherToken } = await createVerifiedUser(`${suffix}-oth`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(r.status).toBe(403);
    }, 30000);
  });

  // ── POST /events/:id/subscribers ────────────────────────────────────────

  describe('POST /events/:id/subscribers', () => {
    test('owner can create a subscriber (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send(BASE_SUBSCRIBER());

      expect(r.status).toBe(201);
      expect(r.body.data.subscriber.firstname).toBe('Alice');
      expect(r.body.data.subscriber.status).toBe('ACTIVE');
      expect(r.body.data.subscriber.contacts[0].isPrimary).toBe(true);
      expect(r.body.data.subscriber.contacts[0].channel).toBe('EMAIL');
    }, 30000);

    test('contributor can create a subscriber (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send(BASE_SUBSCRIBER());

      expect(r.status).toBe(201);
    }, 30000);

    test('reader cannot create a subscriber (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${rdToken}`)
        .send(BASE_SUBSCRIBER());

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated request returns 401', async () => {
      const r = await request(baseUrl)
        .post('/api/v1/events/00000000-0000-0000-0000-000000000000/subscribers')
        .send(BASE_SUBSCRIBER());
      expect(r.status).toBe(401);
    }, 10000);

    test('returns 422 when firstname is missing', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-val`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const body = { ...BASE_SUBSCRIBER() };
      delete body.firstname;

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(r.status).toBe(422);
    }, 30000);

    test('returns 422 when contacts array is empty', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-cre-noct`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Alice', lastname: 'Test', contacts: [] });

      expect(r.status).toBe(422);
    }, 30000);
  });

  // ── PATCH /events/:id/subscribers/:sid ──────────────────────────────────

  describe('PATCH /events/:id/subscribers/:sid', () => {
    test('owner can update a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/subscribers/${sub.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstname: 'Alicia' });

      expect(r.status).toBe(200);
      expect(r.body.data.subscriber.firstname).toBe('Alicia');
    }, 30000);

    test('contributor can update a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/subscribers/${sub.id}`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ lastname: 'Updated' });

      expect(r.status).toBe(200);
    }, 30000);

    test('reader cannot update a subscriber (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-upd-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/subscribers/${sub.id}`)
        .set('Authorization', `Bearer ${rdToken}`)
        .send({ firstname: 'Hack' });

      expect(r.status).toBe(403);
    }, 30000);
  });

  // ── DELETE /events/:id/subscribers/:sid ─────────────────────────────────

  describe('DELETE /events/:id/subscribers/:sid', () => {
    test('owner can delete a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      // Create 2 so the last-subscriber guard doesn't fire
      await createSubscriber(token, eid);
      const sub2 = await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub2.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.deleted).toBe(true);
    }, 30000);

    test('contributor can delete a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      await createSubscriber(ownerToken, eid);
      const sub2 = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub2.id}`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('reader cannot delete a subscriber (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub.id}`)
        .set('Authorization', `Bearer ${rdToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('returns 409 when trying to delete the last active subscriber', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-del-last`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_SUBSCRIBER');
    }, 30000);
  });

  // ── POST /events/:id/subscribers/:sid/unsubscribe ────────────────────────

  describe('POST /events/:id/subscribers/:sid/unsubscribe', () => {
    test('owner can unsubscribe a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-unsub-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/unsubscribe`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.subscriber.status).toBe('UNSUBSCRIBED');
    }, 30000);

    test('contributor can unsubscribe a subscriber (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-unsub-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/unsubscribe`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('reader cannot unsubscribe (403)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-unsub-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: rdId, token: rdToken } = await createVerifiedUser(`${suffix}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/unsubscribe`)
        .set('Authorization', `Bearer ${rdToken}`);

      expect(r.status).toBe(403);
    }, 30000);
  });

  // ── Contact management ───────────────────────────────────────────────────

  describe('POST /events/:id/subscribers/:sid/contacts', () => {
    test('owner can add a contact (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-addct-own`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'sms', contact_value: '+15551234567', is_primary: false });

      expect(r.status).toBe(201);
      expect(r.body.data.contact.channel).toBe('SMS');
    }, 30000);

    test('contributor can add a contact (201)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-addct-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${suffix}-own`);
      const { userId: ctId, token: ctToken } = await createVerifiedUser(`${suffix}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');
      const sub = await createSubscriber(ownerToken, eid);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ channel: 'sms', contact_value: '+15559876543', is_primary: false });

      expect(r.status).toBe(201);
    }, 30000);
  });

  describe('PATCH /events/:id/subscribers/:sid/contacts/:cid — primary flag', () => {
    test('owner can set a contact as primary (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-primary`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);
      // Add a second contact (non-primary)
      const addR = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'sms', contact_value: '+15551111111', is_primary: false });
      const cid = addR.body.data.contact.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts/${cid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ is_primary: true });

      expect(r.status).toBe(200);
      expect(r.body.data.contact.isPrimary).toBe(true);
    }, 30000);
  });

  describe('DELETE /events/:id/subscribers/:sid/contacts/:cid', () => {
    test('owner can delete a non-last contact (200)', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-delct`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);
      // Add a second contact then delete it
      const addR = await request(baseUrl)
        .post(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'sms', contact_value: '+15552222222', is_primary: false });
      const cid = addR.body.data.contact.id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts/${cid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
    }, 30000);

    test('returns 409 when deleting the only active contact', async () => {
      const suffix = `${Date.now() % 1e6}-w${WORKER_ID}-lastct`;
      const { token } = await createVerifiedUser(suffix);
      const eid = await createEvent(token);
      const sub = await createSubscriber(token, eid);
      const cid = sub.contacts[0].id;

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/subscribers/${sub.id}/contacts/${cid}`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('LAST_CONTACT');
    }, 30000);
  });
});
