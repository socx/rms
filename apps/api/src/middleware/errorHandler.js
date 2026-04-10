export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ success: false, data: null, error: {
    code: err.code || 'INTERNAL_ERROR',
    message: status === 500 ? 'An unexpected error occurred.' : err.message,
  }});
}
