export const ok      = (res, data, meta=null, status=200) =>
  res.status(status).json({ success: true, data, meta, error: null });
export const created = (res, data) => ok(res, data, null, 201);
export const fail    = (res, code, message, status=400, details=null) =>
  res.status(status).json({ success: false, data: null, error: { code, message, details } });
export const notFound  = (res, msg='Resource not found.') => fail(res, 'NOT_FOUND', msg, 404);
export const forbidden = (res, msg='Insufficient permissions.') => fail(res, 'FORBIDDEN', msg, 403);
export const conflict  = (res, code, msg) => fail(res, code, msg, 409);
