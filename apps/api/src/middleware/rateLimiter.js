import rateLimit from 'express-rate-limit';
// TODO: Replace MemoryStore with RedisStore from 'rate-limit-redis' when scaling horizontally.
// import RedisStore from 'rate-limit-redis';
// store: new RedisStore({ client: redisClient })

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (!req.user) return 300;
    if (req.user.systemRole === 'system_admin') return 1000;
    if (req.headers['x-api-key']) return 600;
    return 300;
  },
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = new Date(Date.now() + 60000).toISOString();
    res.status(429).json({ success: false, data: null, error: {
      code: 'RATE_LIMIT_EXCEEDED', message: `Too many requests. Retry after ${retryAfter}.`, retry_after: retryAfter,
    }});
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, keyGenerator: (req) => req.ip,
  standardHeaders: true, legacyHeaders: false,
});
