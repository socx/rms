import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, created, fail, forbidden, notFound, conflict } from '../utils/response.js';

export const apiKeysRouter = Router();

const MAX_ACTIVE_KEYS = 10;

// Scope string (API surface) <-> Prisma enum name
const SCOPE_TO_PRISMA = {
  'users:read':        'USERS_READ',
  'events:read':       'EVENTS_READ',
  'events:write':      'EVENTS_WRITE',
  'subscribers:read':  'SUBSCRIBERS_READ',
  'subscribers:write': 'SUBSCRIBERS_WRITE',
  'reports:read':      'REPORTS_READ',
};
const VALID_SCOPES = new Set(Object.keys(SCOPE_TO_PRISMA));
const PRISMA_TO_SCOPE = Object.fromEntries(
  Object.entries(SCOPE_TO_PRISMA).map(([k, v]) => [v, k]),
);

/**
 * Generate a new rms_-prefixed API key.
 * rawKey  : rms_ + 64 hex chars (68 chars total)
 * prefix  : first 8 chars of rawKey ("rms_" + 4 hex chars), stored in DB
 * keyHash : SHA-256 of rawKey, stored in DB — raw key never stored
 */
function generateApiKey() {
  const random  = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const rawKey  = `rms_${random}`;
  const prefix  = rawKey.slice(0, 8);                    // "rms_XXXX"
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, prefix, keyHash };
}

/** True if req.user is acting on behalf of :id */
const isSelf  = (req) => req.user.id === req.params.id;
const isAdmin = (req) => String(req.user.systemRole).toLowerCase() === 'system_admin';

/** Serialize an ApiKey (with scopes included) to the API response shape */
function formatKey(key) {
  return {
    id:          key.id,
    key_prefix:  key.keyPrefix,
    name:        key.name,
    status:      String(key.status).toLowerCase(),
    last_used_at: key.lastUsedAt  ?? null,
    expires_at:   key.expiresAt   ?? null,
    created_at:   key.createdAt,
    scopes:      (key.scopes ?? []).map(s => PRISMA_TO_SCOPE[s.scope] ?? s.scope),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /users/:id/api-keys  — self only
// Create a new API key. Raw key returned once only.
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.post('/:id/api-keys', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req)) return forbidden(res, 'You can only manage your own API keys.');

    const { name, expires_at, scopes: scopesInput } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'name is required.', 422);
    }

    // Validate optional scopes
    const scopeList = Array.isArray(scopesInput) ? scopesInput : [];
    const invalidScopes = scopeList.filter(s => !VALID_SCOPES.has(s));
    if (invalidScopes.length > 0) {
      return fail(res, 'INVALID_PAYLOAD', `Invalid scopes: ${invalidScopes.join(', ')}. Valid values: ${[...VALID_SCOPES].join(', ')}`, 422);
    }

    // Validate optional expires_at
    let expiresAt = null;
    if (expires_at != null) {
      expiresAt = new Date(expires_at);
      if (isNaN(expiresAt.getTime())) {
        return fail(res, 'INVALID_PAYLOAD', 'expires_at must be a valid ISO 8601 datetime.', 422);
      }
      if (expiresAt <= new Date()) {
        return fail(res, 'INVALID_PAYLOAD', 'expires_at must be in the future.', 422);
      }
    }

    // 10 active-key limit
    const activeCount = await prisma.apiKey.count({
      where: { userId: req.params.id, status: 'ACTIVE' },
    });
    if (activeCount >= MAX_ACTIVE_KEYS) {
      return conflict(res, 'KEY_LIMIT_REACHED', 'Maximum 10 active API keys per user.');
    }

    const { rawKey, prefix, keyHash } = generateApiKey();

    const key = await prisma.apiKey.create({
      data: {
        userId:    req.params.id,
        keyHash,
        keyPrefix: prefix,
        name:      name.trim(),
        expiresAt,
        scopes: {
          create: scopeList.map(s => ({ scope: SCOPE_TO_PRISMA[s] })),
        },
      },
      include: { scopes: true },
    });

    return created(res, { api_key: { ...formatKey(key), raw_key: rawKey } });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/:id/api-keys  — self only (admins listed explicitly as self)
// Lists keys with prefix and metadata — never the raw key.
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.get('/:id/api-keys', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req) && !isAdmin(req)) return forbidden(res, 'You can only view your own API keys.');

    const keys = await prisma.apiKey.findMany({
      where:   { userId: req.params.id },
      include: { scopes: true },
      orderBy: { createdAt: 'desc' },
    });

    return ok(res, { api_keys: keys.map(formatKey) });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /users/:id/api-keys/:kid  — self only
// Update name and/or expires_at. Blocked on revoked keys.
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.patch('/:id/api-keys/:kid', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req)) return forbidden(res, 'You can only manage your own API keys.');

    const key = await prisma.apiKey.findUnique({ where: { id: req.params.kid } });
    if (!key || key.userId !== req.params.id) return notFound(res, 'API key not found.');

    if (String(key.status).toLowerCase() === 'revoked') {
      return conflict(res, 'KEY_REVOKED', 'Cannot update a revoked API key.');
    }

    const { name, expires_at } = req.body || {};
    const data = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return fail(res, 'INVALID_PAYLOAD', 'name must be a non-empty string.', 422);
      }
      data.name = name.trim();
    }

    if (expires_at !== undefined) {
      if (expires_at === null) {
        data.expiresAt = null;
      } else {
        const d = new Date(expires_at);
        if (isNaN(d.getTime())) {
          return fail(res, 'INVALID_PAYLOAD', 'expires_at must be a valid ISO 8601 datetime.', 422);
        }
        if (d <= new Date()) {
          return fail(res, 'INVALID_PAYLOAD', 'expires_at must be in the future.', 422);
        }
        data.expiresAt = d;
      }
    }

    if (Object.keys(data).length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'No updatable fields provided (name, expires_at).', 400);
    }

    const updated = await prisma.apiKey.update({
      where:   { id: req.params.kid },
      data,
      include: { scopes: true },
    });

    return ok(res, { api_key: formatKey(updated) });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /users/:id/api-keys/:kid/revoke  — self or admin
// Immediately revokes this key. Idempotent: revoked key → 409.
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.post('/:id/api-keys/:kid/revoke', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req) && !isAdmin(req)) return forbidden(res, 'Insufficient permissions.');

    const key = await prisma.apiKey.findUnique({ where: { id: req.params.kid } });
    if (!key || key.userId !== req.params.id) return notFound(res, 'API key not found.');

    if (String(key.status).toLowerCase() === 'revoked') {
      return conflict(res, 'KEY_ALREADY_REVOKED', 'This API key is already revoked.');
    }

    const updated = await prisma.apiKey.update({
      where:   { id: req.params.kid },
      data:    { status: 'REVOKED', revokedAt: new Date() },
      include: { scopes: true },
    });

    return ok(res, { api_key: formatKey(updated) });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/:id/api-keys/:kid/scopes  — self only
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.get('/:id/api-keys/:kid/scopes', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req) && !isAdmin(req)) return forbidden(res, 'You can only view your own API keys.');

    const key = await prisma.apiKey.findUnique({
      where:   { id: req.params.kid },
      include: { scopes: true },
    });
    if (!key || key.userId !== req.params.id) return notFound(res, 'API key not found.');

    const scopes = key.scopes.map(s => PRISMA_TO_SCOPE[s.scope] ?? s.scope);
    return ok(res, { scopes });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /users/:id/api-keys/:kid/scopes  — self only
// Replaces the entire scope list. Empty array = unrestricted.
// ─────────────────────────────────────────────────────────────────────────────
apiKeysRouter.put('/:id/api-keys/:kid/scopes', authenticate, async (req, res, next) => {
  try {
    if (!isSelf(req)) return forbidden(res, 'You can only manage your own API keys.');

    const key = await prisma.apiKey.findUnique({ where: { id: req.params.kid } });
    if (!key || key.userId !== req.params.id) return notFound(res, 'API key not found.');

    if (String(key.status).toLowerCase() === 'revoked') {
      return conflict(res, 'KEY_REVOKED', 'Cannot update scopes on a revoked API key.');
    }

    const { scopes: scopesInput } = req.body || {};
    if (!Array.isArray(scopesInput)) {
      return fail(res, 'INVALID_PAYLOAD', 'scopes must be an array.', 422);
    }

    const invalidScopes = scopesInput.filter(s => !VALID_SCOPES.has(s));
    if (invalidScopes.length > 0) {
      return fail(res, 'INVALID_PAYLOAD', `Invalid scopes: ${invalidScopes.join(', ')}`, 422);
    }

    // Replace all scopes atomically
    await prisma.$transaction(async (tx) => {
      await tx.api_key_scope_.deleteMany({ where: { apiKeyId: key.id } });
      for (const s of scopesInput) {
        await tx.api_key_scope_.create({ data: { apiKeyId: key.id, scope: SCOPE_TO_PRISMA[s] } });
      }
    });

    const updated = await prisma.apiKey.findUnique({
      where:   { id: key.id },
      include: { scopes: true },
    });
    return ok(res, { scopes: (updated.scopes ?? []).map(s => PRISMA_TO_SCOPE[s.scope] ?? s.scope) });
  } catch (e) { next(e); }
});
