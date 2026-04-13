import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';

export async function authenticate(req, res, next) {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : null;
    const apiKey = req.headers['x-api-key'] || null;

    if (bearer) {
      const payload = jwt.verify(bearer, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || String(user.status).toLowerCase() !== 'active') return unauthorized(res);
      if (!user.emailVerified) return res.status(403).json(err('EMAIL_NOT_VERIFIED', 'Please verify your email.'));
      req.user = user; req.apiKeyScopes = null;
      return next();
    }

    if (apiKey) {
      const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const key = await prisma.apiKey.findUnique({ where: { keyHash: hash }, include: { user: true, scopes: true } });
      if (!key || String(key.status).toLowerCase() !== 'active') return unauthorized(res);
      if (key.expiresAt && key.expiresAt < new Date())
        return res.status(401).json(err('API_KEY_EXPIRED', 'This API key has expired.'));
      if (!key.user || String(key.user.status).toLowerCase() !== 'active') return unauthorized(res);
      // Fire-and-forget last_used_at update
      prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      req.user = key.user;
      req.apiKeyScopes = key.scopes.length > 0 ? key.scopes.map(s => s.scope) : null;
      return next();
    }

    return unauthorized(res);
  } catch { return unauthorized(res); }
}

export function requireEventRole(...roles) {
  return async (req, res, next) => {
    // Allow system_admin regardless of event access (case-insensitive)
    if (String(req.user.systemRole).toLowerCase() === 'system_admin') return next();

    // Allow event owner
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
    if (event && event.ownerId === req.user.id) {
      req.eventRole = 'OWNER';
      return next();
    }

    const access = await prisma.eventAccess.findUnique({
      where: { eventId_userId: { eventId: req.params.id, userId: req.user.id } },
    });
    if (!access || !roles.includes(access.role))
      return res.status(403).json(err('FORBIDDEN', 'Insufficient event access.'));
    req.eventRole = access.role;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (String(req.user?.systemRole).toLowerCase() !== 'system_admin')
    return res.status(403).json(err('FORBIDDEN', 'system_admin role required.'));
  next();
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (req.apiKeyScopes === null) return next();
    if (!req.apiKeyScopes.includes(scope))
      return res.status(403).json(err('INSUFFICIENT_SCOPE', `Scope required: ${scope}`));
    next();
  };
}

const unauthorized = (res) => res.status(401).json(err('UNAUTHORIZED', 'Authentication required.'));
const err = (code, message) => ({ success: false, data: null, error: { code, message } });
