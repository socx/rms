/**
 * accessRoles.test.js
 *
 * Role-scoped access tests for the Event Access (Grants) endpoints.
 *
 * Coverage:
 *  GET  /events/:id/access              — OWNER (200+grants); CONTRIBUTOR (403); READER (403); unauthenticated (401); no-access (403)
 *  POST /events/:id/access              — OWNER (201+grant); CONTRIBUTOR (403); unauthenticated (401)
 *                                         ACCESS_EXISTS (409); USER_IS_OWNER (400); USER_NOT_FOUND (400); INVALID_ROLE (400)
 *  PATCH /events/:id/access/:uid        — OWNER (200); CONTRIBUTOR (403); CANNOT_CHANGE_OWNER_ROLE (400)
 *  DELETE /events/:id/access/:uid       — OWNER (200); CONTRIBUTOR (403); CANNOT_REVOKE_OWNER (400)
 *  PATCH /events/:id/owner              — OWNER transfers ownership (200+new ownerId); non-owner (403)
 */

const request  = require('supertest');
const path     = require('path');
const dotenv   = require('dotenv');
const fs       = require('fs');
const jwt      = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Access grants — role-scoped access', () => {
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
    const email = `accgrnt+${suffix}+w${WORKER_ID}@example.com`;
    const pw    = 'Password01';
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Access', lastname: 'Test', email, password: pw, timezone: 'UTC' })
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
    const r  = await request(baseUrl)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Access Roles Test Event', eventDatetime: dt, eventTimezone: 'UTC' })
      .set('Accept', 'application/json');
    return r.body.data.event.id;
  }

  async function grantRole(eventId, userId, grantedById, role) {
    await prisma.eventAccess.create({ data: { eventId, userId, role, grantedById } });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl    = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ── GET /events/:id/access ───────────────────────────────────────────────

  describe('GET /events/:id/access', () => {
    test('owner gets empty grants list (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-own`;
      const { token } = await createVerifiedUser(s);
      const eid       = await createEvent(token);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.grants)).toBe(true);
      expect(r.body.data.grants.length).toBe(0);
    }, 30000);

    test('owner sees existing grants with user info (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-ownfill`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId }                        = await createVerifiedUser(`${s}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(r.status).toBe(200);
      expect(r.body.data.grants.length).toBe(1);
      const g = r.body.data.grants[0];
      expect(g.userId).toBe(ctId);
      expect(g.role).toBe('CONTRIBUTOR');
      expect(g.user).toBeDefined();
      expect(g.user.email).toBeDefined();
    }, 30000);

    test('contributor cannot list grants (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId, token: ctToken }        = await createVerifiedUser(`${s}-ct`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('reader cannot list grants (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-rd`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: rdId, token: rdToken }        = await createVerifiedUser(`${s}-rd`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, rdId, ownerId, 'READER');

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${rdToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated cannot list grants (401)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-unauth`;
      const { token } = await createVerifiedUser(s);
      const eid       = await createEvent(token);

      const r = await request(baseUrl).get(`/api/v1/events/${eid}/access`);

      expect(r.status).toBe(401);
    }, 30000);

    test('authenticated user with no access cannot list grants (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-g-noacc`;
      const { token: ownerToken }  = await createVerifiedUser(`${s}-own`);
      const { token: otherToken }  = await createVerifiedUser(`${s}-oth`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .get(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(r.status).toBe(403);
    }, 30000);
  });

  // ── POST /events/:id/access ──────────────────────────────────────────────

  describe('POST /events/:id/access', () => {
    test('owner can grant access — returns grant with user (201)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-own`;
      const { token: ownerToken } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }  = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: targetId, role: 'CONTRIBUTOR' });

      expect(r.status).toBe(201);
      const g = r.body.data.grant;
      expect(g.userId).toBe(targetId);
      expect(g.role).toBe('CONTRIBUTOR');
      expect(g.user).toBeDefined();
      expect(g.user.id).toBe(targetId);
    }, 30000);

    test('owner can grant READER role (201)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-rd`;
      const { token: ownerToken } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }  = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: targetId, role: 'READER' });

      expect(r.status).toBe(201);
      expect(r.body.data.grant.role).toBe('READER');
    }, 30000);

    test('contributor cannot grant access (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId, token: ctToken }        = await createVerifiedUser(`${s}-ct`);
      const { userId: targetId }                    = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ userId: targetId, role: 'READER' });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated cannot grant access (401)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-unauth`;
      const { token, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }       = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(token);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .send({ userId: targetId, role: 'CONTRIBUTOR' });

      expect(r.status).toBe(401);
    }, 30000);

    test('rejects duplicate grant — ACCESS_EXISTS (409)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-dup`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: targetId, role: 'CONTRIBUTOR' });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ACCESS_EXISTS');
    }, 30000);

    test('rejects granting access to owner — USER_IS_OWNER (400)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-isown`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ownerId, role: 'CONTRIBUTOR' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('USER_IS_OWNER');
    }, 30000);

    test('rejects unknown user — USER_NOT_FOUND (400)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-notfnd`;
      const { token: ownerToken } = await createVerifiedUser(`${s}-own`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: '00000000-0000-0000-0000-000000000000', role: 'CONTRIBUTOR' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('USER_NOT_FOUND');
    }, 30000);

    test('rejects invalid role — INVALID_ROLE (400)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-badrole`;
      const { token: ownerToken } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }  = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: targetId, role: 'OWNER' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_ROLE');
    }, 30000);

    test('rejects missing payload (422)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-p-nopl`;
      const { token: ownerToken } = await createVerifiedUser(s);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .post(`/api/v1/events/${eid}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});

      expect(r.status).toBe(400);
    }, 30000);
  });

  // ── PATCH /events/:id/access/:uid ────────────────────────────────────────

  describe('PATCH /events/:id/access/:uid', () => {
    test('owner can update role CONTRIBUTOR → READER (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-u-own`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/access/${targetId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'READER' });

      expect(r.status).toBe(200);
      expect(r.body.data.grant.role).toBe('READER');
    }, 30000);

    test('owner can update role READER → CONTRIBUTOR (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-u-ownrc`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/access/${targetId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'CONTRIBUTOR' });

      expect(r.status).toBe(200);
      expect(r.body.data.grant.role).toBe('CONTRIBUTOR');
    }, 30000);

    test('contributor cannot update role (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-u-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId, token: ctToken }        = await createVerifiedUser(`${s}-ct`);
      const { userId: targetId }                    = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId,     ownerId, 'CONTRIBUTOR');
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/access/${targetId}`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ role: 'CONTRIBUTOR' });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated cannot update role (401)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-u-unauth`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/access/${targetId}`)
        .send({ role: 'CONTRIBUTOR' });

      expect(r.status).toBe(401);
    }, 30000);

    test('cannot change role for event owner — CANNOT_CHANGE_OWNER_ROLE (400)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-u-cco`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/access/${ownerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'READER' });

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('CANNOT_CHANGE_OWNER_ROLE');
    }, 30000);
  });

  // ── DELETE /events/:id/access/:uid ───────────────────────────────────────

  describe('DELETE /events/:id/access/:uid', () => {
    test('owner can revoke a grant (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-d-own`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/access/${targetId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(r.status).toBe(200);
      expect(r.body.data.message).toMatch(/revoked/i);
    }, 30000);

    test('contributor cannot revoke access (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-d-ct`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId, token: ctToken }        = await createVerifiedUser(`${s}-ct`);
      const { userId: targetId }                    = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId,     ownerId, 'CONTRIBUTOR');
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/access/${targetId}`)
        .set('Authorization', `Bearer ${ctToken}`);

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated cannot revoke access (401)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-d-unauth`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: targetId }                   = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, targetId, ownerId, 'READER');

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/access/${targetId}`);

      expect(r.status).toBe(401);
    }, 30000);

    test('cannot revoke owner — CANNOT_REVOKE_OWNER (400)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-d-cro`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .delete(`/api/v1/events/${eid}/access/${ownerId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('CANNOT_REVOKE_OWNER');
    }, 30000);
  });

  // ── PATCH /events/:id/owner ──────────────────────────────────────────────

  describe('PATCH /events/:id/owner (transfer ownership)', () => {
    test('owner can transfer ownership — response has new ownerId (200)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-to-own`;
      const { token: ownerToken }   = await createVerifiedUser(`${s}-own`);
      const { userId: newOwnerId }  = await createVerifiedUser(`${s}-new`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/owner`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ newOwnerId });

      expect(r.status).toBe(200);
      expect(r.body.data.event.ownerId).toBe(newOwnerId);
    }, 30000);

    test('non-owner cannot transfer ownership (403)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-to-nown`;
      const { token: ownerToken, userId: ownerId } = await createVerifiedUser(`${s}-own`);
      const { userId: ctId, token: ctToken }        = await createVerifiedUser(`${s}-ct`);
      const { userId: targetId }                    = await createVerifiedUser(`${s}-tgt`);
      const eid = await createEvent(ownerToken);
      await grantRole(eid, ctId, ownerId, 'CONTRIBUTOR');

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/owner`)
        .set('Authorization', `Bearer ${ctToken}`)
        .send({ newOwnerId: targetId });

      expect(r.status).toBe(403);
    }, 30000);

    test('unauthenticated cannot transfer ownership (401)', async () => {
      const s = `${Date.now() % 1e6}-w${WORKER_ID}-to-unauth`;
      const { token: ownerToken }  = await createVerifiedUser(`${s}-own`);
      const { userId: newOwnerId } = await createVerifiedUser(`${s}-new`);
      const eid = await createEvent(ownerToken);

      const r = await request(baseUrl)
        .patch(`/api/v1/events/${eid}/owner`)
        .send({ newOwnerId });

      expect(r.status).toBe(401);
    }, 30000);
  });
});
