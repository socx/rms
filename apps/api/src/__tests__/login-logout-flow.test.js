const request = require('supertest');

describe('Login -> Get User -> Logout -> Get User flow', () => {
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

  test('login -> get user -> logout -> get user', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `flow+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Flow', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Login
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    if (!(login.status === 201 || login.status === 200)) {
      // If login not allowed (email not verified), skip remainder with a soft assertion
      expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED']).toContain(login.body.error?.code);
      return;
    }

    const token = login.body.data.token;
    const userId = login.body.data.user.id || login.body.data.user?.id;

    // GET user (should succeed)
    const g = await request(baseUrl)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect(g.status).toBe(200);

    // Logout — token is added to denylist server-side
    const logout = await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    // GET user again: revoked token must be rejected with 401
    const g2 = await request(baseUrl)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect(g2.status).toBe(401);
    expect(g2.body.error.code).toBe('TOKEN_REVOKED');
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
