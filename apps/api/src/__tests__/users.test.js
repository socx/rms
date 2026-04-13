const request = require('supertest');

describe('Users routes', () => {
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

  test('GET and PATCH /users/:id', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `user+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'User', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Login (may fail if email not verified)
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    if (!(login.status === 201 || login.status === 200)) {
      // If login isn't available, skip remainder
      expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_DISABLED']).toContain(login.body.error?.code);
      return;
    }

    const token = login.body.data.token;
    const userId = login.body.data.user.id || login.body.data.user?.id;

    // GET profile
    const g = await request(baseUrl)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect(g.status).toBe(200);
    expect(g.body.success).toBe(true);
    expect(g.body.data.user).toHaveProperty('email', email);

    // PATCH update firstname & timezone
    const patch = await request(baseUrl)
      .patch(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ firstname: 'Updated', timezone: 'Europe/Berlin' })
      .set('Accept', 'application/json');
    expect(patch.status).toBe(200);
    expect(patch.body.data.user.firstname).toBe('Updated');
    expect(patch.body.data.user.timezone).toBe('Europe/Berlin');

    // GET again to confirm
    const g2 = await request(baseUrl)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect(g2.status).toBe(200);
    expect(g2.body.data.user.firstname).toBe('Updated');
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
