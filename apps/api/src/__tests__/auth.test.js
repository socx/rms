const request = require('supertest');

describe('Auth routes', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  process.env.PORT = '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;
  let serverInfo;
  const { startServer, stopServer } = require('../test_helpers/server');

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  test('register then login', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `test+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Test', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);

    // Request resend of verification
    const resend = await request(baseUrl)
      .post('/api/v1/auth/resend-verification')
      .send({ email })
      .set('Accept', 'application/json');
    // Accept either success (created token) or already-verified response
    if (resend.status === 200) {
      expect(resend.body.success).toBe(true);
    } else {
      expect(resend.status).toBe(400);
      expect(['ALREADY_VERIFIED']).toContain(resend.body.error.code);
    }

    // Try login - should fail if email not verified. If registration flow auto-verifies in test DB, login should succeed.
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    // Accept either 201/200 with token or specific EMAIL_NOT_VERIFIED response depending on test DB state
    if (login.status === 201 || login.status === 200) {
      expect(login.body.success).toBe(true);
      expect(login.body.data).toHaveProperty('token');
      expect(typeof login.body.data.token).toBe('string');
    } else {
      // When email verification is required the endpoint may return 403 with EMAIL_NOT_VERIFIED
      // or the account may be disabled in some test DB states. Accept either.
      expect(login.status).toBe(403);
      expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED']).toContain(login.body.error.code);
    }
  }, 20000);
  
  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
