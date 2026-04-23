import rateLimit from 'express-rate-limit';
// TODO: Replace MemoryStore with RedisStore from 'rate-limit-redis' when scaling horizontally.
// import RedisStore from 'rate-limit-redis';
// store: new RedisStore({ client: redisClient })

const retryAfterIso = (windowMs) => new Date(Date.now() + windowMs).toISOString();

const make429Handler = (windowMs) => (req, res) => {
  const retryAfter = retryAfterIso(windowMs);
  res.status(429).json({ success: false, data: null, error: {
    code: 'RATE_LIMIT_EXCEEDED', message: `Too many requests. Retry after ${retryAfter}.`, retry_after: retryAfter,
  }});
};

// Unauthenticated: 15 min / 100 req per IP.
const _unauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: make429Handler(15 * 60 * 1000),
});

// Authenticated: 1 min / tiered by role (keyed on user.id or API key prefix).
// req.user may not be populated here (auth happens per-route), so systemRole tier
// falls back to 300 for invalid/missing tokens; verified routes enforce auth separately.
const _authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (req.user && String(req.user.systemRole).toLowerCase() === 'system_admin') return 1000;
    if (req.headers['x-api-key']) return 600;
    return 300;
  },
  keyGenerator: (req) => req.user?.id || req.headers['x-api-key'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: make429Handler(60 * 1000),
});

// Auth brute-force limiter instance (wrapped below).
const _authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: make429Handler(15 * 60 * 1000),
});

// Resend verification limiter instance (wrapped below).
const _resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.body?.email || req.ip).toLowerCase(),
  standardHeaders: true,
  legacyHeaders: false,
  handler: make429Handler(60 * 60 * 1000),
});

// Rate limit checks are skipped in test environments. Checked at request time
// (not module init) because test files may override NODE_ENV after module load.
// Uses JEST_WORKER_ID as the reliable test signal since Jest sets it unconditionally.

// General API rate limiter — dispatches to the correct limiter based on whether
// auth headers are present. Actual credential verification is still done per-route.
export const rateLimiter = (req, res, next) => {
  if (process.env.JEST_WORKER_ID) return next();
  const hasAuth = !!(req.headers.authorization || req.headers['x-api-key']);
  return hasAuth ? _authLimiter(req, res, next) : _unauthLimiter(req, res, next);
};

// Auth endpoints (/auth/*) — 15 min / 20 attempts per IP (brute-force protection).
export const authRateLimiter = (req, res, next) => {
  if (process.env.JEST_WORKER_ID) return next();
  return _authRateLimiter(req, res, next);
};

// Resend verification — 1 hour / 3 requests per email address.
export const resendVerificationLimiter = (req, res, next) => {
  if (process.env.JEST_WORKER_ID) return next();
  return _resendVerificationLimiter(req, res, next);
};
