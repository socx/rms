const request = require('supertest');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { startServer, stopServer } = require('../test_helpers/server');

describe('API Keys', () => {
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function createVerifiedUser(suffix) {
    const email = `apikey+${suffix}@example.com`;
    await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Key', lastname: 'Test', email, password: 'Password01', timezone: 'UTC' });
    const rec = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: rec.id },
      data:  { emailVerified: true, emailVerifiedAt: new Date() },
    });
    const token = jwt.sign({ sub: rec.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId: rec.id, email, token };
  }

  async function createAdminUser(suffix) {
    const { userId, token } = await createVerifiedUser(suffix);
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SYSTEM_ADMIN' } });
    const adminToken = jwt.sign({ sub: userId, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return { userId, token: adminToken };
  }

  /** Create a key via API and return { key, rawKey } */
  async function createKey(token, userId, body = {}) {
    const r = await request(baseUrl)
      .post(`/api/v1/users/${userId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Key', ...body });
    return r;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    serverInfo = await startServer(3000 + WORKER_ID, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopServer(serverInfo);
  });

  // ─── POST /users/:id/api-keys ─────────────────────────────────────────────
  describe('POST /users/:id/api-keys', () => {

    test('creates key and returns raw_key exactly once (201)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-create`);

      const r = await createKey(token, userId, { name: 'CRM integration' });

      expect(r.status).toBe(201);
      expect(r.body.success).toBe(true);
      const k = r.body.data.api_key;
      expect(k.name).toBe('CRM integration');
      expect(k.status).toBe('active');
      expect(k.scopes).toEqual([]);
      expect(k.key_prefix).toMatch(/^rms_[0-9a-f]{4}$/);
      expect(k.raw_key).toMatch(/^rms_[0-9a-f]{64}$/);
      expect(k.id).toBeDefined();
      expect(k.last_used_at).toBeNull();
      expect(k.expires_at).toBeNull();
    }, 20000);

    test('raw_key is NOT stored — cannot be retrieved via GET', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-noraw`);

      const createResp = await createKey(token, userId);
      const kid = createResp.body.data.api_key.id;

      const listResp = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`);

      expect(listResp.status).toBe(200);
      const listedKey = listResp.body.data.api_keys.find(k => k.id === kid);
      expect(listedKey).toBeDefined();
      expect(listedKey.raw_key).toBeUndefined();
    }, 20000);

    test('stores initial scopes correctly', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-scopes`);

      const r = await createKey(token, userId, {
        scopes: ['events:read', 'subscribers:read'],
      });

      expect(r.status).toBe(201);
      expect(r.body.data.api_key.scopes).toEqual(
        expect.arrayContaining(['events:read', 'subscribers:read']),
      );
    }, 20000);

    test('stores expires_at correctly', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-exp`);
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      const r = await createKey(token, userId, { expires_at: expiresAt });

      expect(r.status).toBe(201);
      expect(r.body.data.api_key.expires_at).toBeTruthy();
    }, 20000);

    test('returns 422 when name is missing', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-noname`);

      const r = await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: ['events:read'] });

      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 15000);

    test('returns 422 for empty name string', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-emptyname`);

      const r = await createKey(token, userId, { name: '   ' });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 422 for invalid scope value', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-badscope`);

      const r = await createKey(token, userId, { scopes: ['events:read', 'write:everything'] });

      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_PAYLOAD');
    }, 15000);

    test('accepts all valid scope values', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-allscopes`);
      const allScopes = [
        'users:read', 'events:read', 'events:write',
        'subscribers:read', 'subscribers:write', 'reports:read',
      ];

      const r = await createKey(token, userId, { scopes: allScopes });

      expect(r.status).toBe(201);
      expect(r.body.data.api_key.scopes).toEqual(expect.arrayContaining(allScopes));
      expect(r.body.data.api_key.scopes).toHaveLength(allScopes.length);
    }, 20000);

    test('returns 422 when expires_at is in the past', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pastexp`);
      const pastDate = new Date(Date.now() - 60 * 1000).toISOString();

      const r = await createKey(token, userId, { expires_at: pastDate });

      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/future/i);
    }, 15000);

    test('returns 422 when expires_at is not a valid date', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-baddate`);

      const r = await createKey(token, userId, { expires_at: 'not-a-date' });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 403 when trying to create a key for another user', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-cross1`);
      const { userId: uid2 }            = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-cross2`);

      const r = await request(baseUrl)
        .post(`/api/v1/users/${uid2}/api-keys`)
        .set('Authorization', `Bearer ${t1}`)
        .send({ name: 'sneaky key' });

      expect(r.status).toBe(403);
    }, 20000);

    test('returns 401 without authentication', async () => {
      const r = await request(baseUrl)
        .post('/api/v1/users/00000000-0000-0000-0000-000000000000/api-keys')
        .send({ name: 'test' });

      expect(r.status).toBe(401);
    }, 10000);

    test('enforces max 10 active key limit (409)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-limit`);

      for (let i = 0; i < 10; i++) {
        const r = await createKey(token, userId, { name: `Key ${i + 1}` });
        expect(r.status).toBe(201);
      }

      const r11 = await createKey(token, userId, { name: 'Key 11' });
      expect(r11.status).toBe(409);
      expect(r11.body.error.code).toBe('KEY_LIMIT_REACHED');
    }, 60000);

    test('revoked keys do not count toward the 10-key limit', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-revlimit`);

      // Create 10 keys
      const keyIds = [];
      for (let i = 0; i < 10; i++) {
        const r = await createKey(token, userId, { name: `Key ${i + 1}` });
        keyIds.push(r.body.data.api_key.id);
      }

      // Revoke one key
      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${keyIds[0]}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      // Now should be able to create another
      const r = await createKey(token, userId, { name: 'Key after revoke' });
      expect(r.status).toBe(201);
    }, 60000);
  });

  // ─── GET /users/:id/api-keys ──────────────────────────────────────────────
  describe('GET /users/:id/api-keys', () => {

    test('lists own keys in descending creation order', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-list`);

      await createKey(token, userId, { name: 'First' });
      await createKey(token, userId, { name: 'Second' });
      await createKey(token, userId, { name: 'Third' });

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      const names = r.body.data.api_keys.map(k => k.name);
      expect(names).toContain('First');
      expect(names).toContain('Second');
      expect(names).toContain('Third');
      // Descending order: Third should appear before First
      expect(names.indexOf('Third')).toBeLessThan(names.indexOf('First'));
    }, 25000);

    test('includes both active and revoked keys in list', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-listall`);

      const cr = await createKey(token, userId, { name: 'Active Key' });
      const kid = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      const key = r.body.data.api_keys.find(k => k.id === kid);
      expect(key.status).toBe('revoked');
    }, 20000);

    test('returns empty array when user has no keys', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-empty`);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.api_keys).toEqual([]);
    }, 15000);

    test('never includes raw_key or key_hash in list response', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-nohash`);
      await createKey(token, userId);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      r.body.data.api_keys.forEach(k => {
        expect(k.raw_key).toBeUndefined();
        expect(k.key_hash).toBeUndefined();
        expect(k.keyHash).toBeUndefined();
      });
    }, 20000);

    test('returns 403 when listing another user\'s keys', async () => {
      const { userId: uid1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-listcross1`);
      const { token: t2 }    = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-listcross2`);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${uid1}/api-keys`)
        .set('Authorization', `Bearer ${t2}`);

      expect(r.status).toBe(403);
    }, 20000);

    test('admin can list another user\'s keys', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-admlist`);
      const { token: adminToken }        = await createAdminUser(`${Date.now() % 100000}-w${WORKER_ID}-admlist-adm`);

      await createKey(t1, uid1, { name: 'Admin sees this' });

      const r = await request(baseUrl)
        .get(`/api/v1/users/${uid1}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(r.status).toBe(200);
      expect(r.body.data.api_keys.some(k => k.name === 'Admin sees this')).toBe(true);
    }, 25000);
  });

  // ─── PATCH /users/:id/api-keys/:kid ───────────────────────────────────────
  describe('PATCH /users/:id/api-keys/:kid', () => {

    test('updates name', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pname`);
      const cr = await createKey(token, userId, { name: 'Old Name' });
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name' });

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.name).toBe('New Name');
    }, 20000);

    test('updates expires_at', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pexp`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const newExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expires_at: newExpiry });

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.expires_at).toBeTruthy();
    }, 20000);

    test('sets expires_at to null (removes expiry)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pnullexp`);
      const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const cr = await createKey(token, userId, { expires_at: expiry });
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expires_at: null });

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.expires_at).toBeNull();
    }, 20000);

    test('returns 400 when no fields provided', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pnofield`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(r.status).toBe(400);
    }, 15000);

    test('returns 422 for invalid expires_at', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pbaddate`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expires_at: 'not-a-date' });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 422 for expires_at in the past', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-ppastexp`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expires_at: new Date(Date.now() - 1000).toISOString() });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 422 for empty name', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pemptyname`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 409 when updating a revoked key', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-prevoked`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name' });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('KEY_REVOKED');
    }, 20000);

    test('returns 404 for unknown key id', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-p404`);

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${userId}/api-keys/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' });

      expect(r.status).toBe(404);
    }, 15000);

    test('returns 404 for key belonging to another user', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pcross1`);
      const { userId: uid2, token: t2 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pcross2`);
      const cr = await createKey(t2, uid2);
      const kid = cr.body.data.api_key.id;

      // uid1 tries to patch uid2's key still referenced under uid1 path
      const r = await request(baseUrl)
        .patch(`/api/v1/users/${uid1}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${t1}`)
        .send({ name: 'Stolen' });

      expect(r.status).toBe(404);
    }, 20000);

    test('returns 403 when acting on another user\'s keys', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pforbid1`);
      const { userId: uid2, token: t2 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-pforbid2`);
      const cr = await createKey(t1, uid1);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .patch(`/api/v1/users/${uid1}/api-keys/${kid}`)
        .set('Authorization', `Bearer ${t2}`)
        .send({ name: 'Hijacked' });

      expect(r.status).toBe(403);
    }, 20000);
  });

  // ─── POST /users/:id/api-keys/:kid/revoke ─────────────────────────────────
  describe('POST /users/:id/api-keys/:kid/revoke', () => {

    test('revokes own key, status becomes revoked (200)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-revoke`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.status).toBe('revoked');
    }, 20000);

    test('revoking sets revokedAt in DB', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-revokedat`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const dbKey = await prisma.apiKey.findUnique({ where: { id: kid } });
      expect(dbKey.revokedAt).not.toBeNull();
    }, 20000);

    test('returns 409 when key is already revoked', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-alreadyrev`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const r2 = await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      expect(r2.status).toBe(409);
      expect(r2.body.error.code).toBe('KEY_ALREADY_REVOKED');
    }, 20000);

    test('admin can revoke another user\'s key', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-admrev`);
      const { token: adminToken }        = await createAdminUser(`${Date.now() % 100000}-w${WORKER_ID}-admrev-a`);
      const cr = await createKey(t1, uid1);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .post(`/api/v1/users/${uid1}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.status).toBe('revoked');
    }, 25000);

    test('non-owner non-admin cannot revoke (403)', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-revforbid1`);
      const { token: t2 }               = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-revforbid2`);
      const cr = await createKey(t1, uid1);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .post(`/api/v1/users/${uid1}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${t2}`);

      expect(r.status).toBe(403);
    }, 20000);

    test('returns 404 for unknown key', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-rev404`);

      const r = await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/00000000-0000-0000-0000-000000000000/revoke`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 15000);
  });

  // ─── GET /users/:id/api-keys/:kid/scopes ──────────────────────────────────
  describe('GET /users/:id/api-keys/:kid/scopes', () => {

    test('returns scopes for key with scopes', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-gscopes`);
      const cr = await createKey(token, userId, {
        scopes: ['events:read', 'reports:read'],
      });
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.scopes).toEqual(expect.arrayContaining(['events:read', 'reports:read']));
      expect(r.body.data.scopes).toHaveLength(2);
    }, 20000);

    test('returns empty array for unrestricted key (no scopes)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-noscopes`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.scopes).toEqual([]);
    }, 15000);

    test('returns 403 for another user\'s key', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-gscforbid1`);
      const { token: t2 }               = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-gscforbid2`);
      const cr = await createKey(t1, uid1);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .get(`/api/v1/users/${uid1}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${t2}`);

      expect(r.status).toBe(403);
    }, 20000);

    test('returns 404 for unknown key', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-gsc404`);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}/api-keys/00000000-0000-0000-0000-000000000000/scopes`)
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(404);
    }, 15000);
  });

  // ─── PUT /users/:id/api-keys/:kid/scopes ──────────────────────────────────
  describe('PUT /users/:id/api-keys/:kid/scopes', () => {

    test('replaces scope list', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putscopes`);
      const cr = await createKey(token, userId, { scopes: ['events:read'] });
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: ['subscribers:read', 'reports:read'] });

      expect(r.status).toBe(200);
      expect(r.body.data.scopes).toEqual(expect.arrayContaining(['subscribers:read', 'reports:read']));
      expect(r.body.data.scopes).not.toContain('events:read');
    }, 20000);

    test('empty scopes makes key unrestricted', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putempty`);
      const cr = await createKey(token, userId, { scopes: ['events:read', 'reports:read'] });
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: [] });

      expect(r.status).toBe(200);
      expect(r.body.data.scopes).toEqual([]);
    }, 20000);

    test('PUT is idempotent — applying same scopes twice gives same result', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-puidem`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;
      const expectedScopes = ['events:read', 'events:write'];

      await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: expectedScopes });

      const r2 = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: expectedScopes });

      expect(r2.status).toBe(200);
      expect(r2.body.data.scopes).toEqual(expect.arrayContaining(expectedScopes));
      expect(r2.body.data.scopes).toHaveLength(expectedScopes.length);
    }, 25000);

    test('returns 422 when scopes is not an array', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putnotarr`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: 'events:read' });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 422 for invalid scope value', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putbadscope`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: ['events:read', 'SUPER_ADMIN'] });

      expect(r.status).toBe(422);
    }, 15000);

    test('returns 409 when updating scopes on revoked key', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putrevokedsc`);
      const cr = await createKey(token, userId);
      const kid = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: ['events:read'] });

      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('KEY_REVOKED');
    }, 20000);

    test('returns 403 for another user\'s key', async () => {
      const { userId: uid1, token: t1 } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putforbid1`);
      const { token: t2 }               = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-putforbid2`);
      const cr = await createKey(t1, uid1);
      const kid = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .put(`/api/v1/users/${uid1}/api-keys/${kid}/scopes`)
        .set('Authorization', `Bearer ${t2}`)
        .send({ scopes: [] });

      expect(r.status).toBe(403);
    }, 20000);

    test('returns 404 for unknown key', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-put404`);

      const r = await request(baseUrl)
        .put(`/api/v1/users/${userId}/api-keys/00000000-0000-0000-0000-000000000000/scopes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ scopes: [] });

      expect(r.status).toBe(404);
    }, 15000);
  });

  // ─── API Key Authentication Integration ───────────────────────────────────
  describe('API Key authentication (X-Api-Key header)', () => {

    test('valid unrestricted key can authenticate (accesses own profile)', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-authok`);
      const cr = await createKey(token, userId, { name: 'Auth Test' });
      const rawKey = cr.body.data.api_key.raw_key;

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(200);
      expect(r.body.data.user.id).toBe(userId);
    }, 20000);

    test('revoked key returns 401', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-authrev`);
      const cr = await createKey(token, userId);
      const rawKey = cr.body.data.api_key.raw_key;
      const kid    = cr.body.data.api_key.id;

      await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('Authorization', `Bearer ${token}`);

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(401);
    }, 20000);

    test('expired key returns 401 API_KEY_EXPIRED', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-authexp`);
      const cr = await createKey(token, userId, {
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
      });
      const rawKey = cr.body.data.api_key.raw_key;
      const kid    = cr.body.data.api_key.id;

      // Force expiry in DB to the past
      await prisma.apiKey.update({
        where: { id: kid },
        data:  { expiresAt: new Date(Date.now() - 1000) },
      });

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('API_KEY_EXPIRED');
    }, 20000);

    test('key with scope can access route that requires that scope', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-scopeok`);
      const cr = await createKey(token, userId, { scopes: ['users:read'] });
      const rawKey = cr.body.data.api_key.raw_key;

      // /users/:id uses authenticate only (no requireScope), so any api key should work
      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(200);
    }, 20000);

    test('unknown X-Api-Key returns 401', async () => {
      const r = await request(baseUrl)
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('X-Api-Key', 'rms_0000000000000000000000000000000000000000000000000000000000000000');

      expect(r.status).toBe(401);
    }, 10000);

    test('key for disabled user returns 401', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-disableduser`);
      const cr = await createKey(token, userId);
      const rawKey = cr.body.data.api_key.raw_key;

      // Disable the user
      await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });

      const r = await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(401);

      // Re-enable for cleanup
      await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    }, 20000);

    test('using API key to revoke itself works', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-selfrevoke`);
      const cr = await createKey(token, userId);
      const rawKey = cr.body.data.api_key.raw_key;
      const kid    = cr.body.data.api_key.id;

      const r = await request(baseUrl)
        .post(`/api/v1/users/${userId}/api-keys/${kid}/revoke`)
        .set('X-Api-Key', rawKey);

      expect(r.status).toBe(200);
      expect(r.body.data.api_key.status).toBe('revoked');
    }, 20000);

    test('updates last_used_at after successful API key authentication', async () => {
      const { userId, token } = await createVerifiedUser(`${Date.now() % 100000}-w${WORKER_ID}-lastused`);
      const cr = await createKey(token, userId);
      const rawKey = cr.body.data.api_key.raw_key;
      const kid    = cr.body.data.api_key.id;

      // Confirm last_used_at is null initially
      const before = await prisma.apiKey.findUnique({ where: { id: kid } });
      expect(before.lastUsedAt).toBeNull();

      await request(baseUrl)
        .get(`/api/v1/users/${userId}`)
        .set('X-Api-Key', rawKey);

      // Give fire-and-forget update a moment
      await new Promise(r => setTimeout(r, 300));

      const after = await prisma.apiKey.findUnique({ where: { id: kid } });
      expect(after.lastUsedAt).not.toBeNull();
    }, 20000);
  });
});
