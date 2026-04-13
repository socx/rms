const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

describe('Auth routes', () => {
  let app;
  beforeAll(async () => {
    app = (await import('../index.js')).default;
  });

  test('register then login', async () => {
    const unique = uuidv4().slice(0,8);
    const email = `test+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Test', lastname: 'User', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);

    // Try login - should fail if email not verified. If registration flow auto-verifies in test DB, login should succeed.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: pw })
      .set('Accept', 'application/json');

    // Accept either 201/200 with token or specific EMAIL_NOT_VERIFIED response depending on test DB state
    if (login.status === 201 || login.status === 200) {
      expect(login.body.success).toBe(true);
      expect(login.body.data).toHaveProperty('token');
      expect(typeof login.body.data.token).toBe('string');
    } else {
      // When email verification is required the endpoint should return 403 with EMAIL_NOT_VERIFIED
      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    }
  }, 20000);
});
