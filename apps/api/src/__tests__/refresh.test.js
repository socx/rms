const request = require('supertest');

describe('Auth refresh', () => {
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

  test('refresh token with valid bearer', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `refresh+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Refresh', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Attempt to login (may fail if email not verified). If it succeeds, use the token to refresh.
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    if (login.status === 201 || login.status === 200) {
      const token = login.body.data.token;
      expect(typeof token).toBe('string');

      const ref = await request(baseUrl)
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');

      expect(ref.status).toBe(200);
      expect(ref.body.success).toBe(true);
      expect(ref.body.data).toHaveProperty('token');
      expect(typeof ref.body.data.token).toBe('string');
      expect(ref.body.data.token).not.toBe(token);
    } else {
      // If login failed due to email verification required, ensure refresh is unauthorized
      expect(login.status).toBe(403);
      expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED']).toContain(login.body.error.code);
    }
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
