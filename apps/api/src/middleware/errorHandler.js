import logger from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  logger.error('unhandled error', {
    status,
    method:  req.method,
    url:     req.originalUrl,
    code:    err.code || 'INTERNAL_ERROR',
    message: err.message,
    stack:   err.stack,
  });

  res.status(status).json({ success: false, data: null, error: {
    code:    err.code || 'INTERNAL_ERROR',
    message: status === 500 ? 'An unexpected error occurred.' : err.message,
  }});
}
