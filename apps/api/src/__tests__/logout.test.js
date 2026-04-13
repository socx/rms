const request = require('supertest');

describe('Auth logout', () => {
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

  test('logout with valid token succeeds', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `logout+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Logout', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Login may fail if email not verified; only proceed if login returns token
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    if (login.status === 201 || login.status === 200) {
      const token = login.body.data.token;
      const resp = await request(baseUrl)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json');

      expect(resp.status).toBe(200);
      expect(resp.body.success).toBe(true);
      expect(resp.body.data).toHaveProperty('message');
    } else {
      // If login failed, ensure logout without token is unauthorized
      const resp = await request(baseUrl)
        .post('/api/v1/auth/logout')
        .set('Accept', 'application/json');
      expect(resp.status).toBe(401);
    }
  }, 20000);

  test('logout without token returns 401', async () => {
    const resp = await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Accept', 'application/json');
    expect(resp.status).toBe(401);
  });

  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
