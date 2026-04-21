import logger from '../utils/logger.js';

/**
 * HTTP request/response logger middleware.
 * Logs incoming request on arrival and outgoing response once finished.
 * 5xx responses are logged at error level; 4xx at warn; everything else at info.
 */
export function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  const start = Date.now();

  logger.info('request', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });

  res.on('finish', () => {
    const ms = Date.now() - start;
    const meta = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms,
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.error('response', meta);
    } else if (res.statusCode >= 400) {
      logger.warn('response', meta);
    } else {
      logger.info('response', meta);
    }
  });

  next();
}
