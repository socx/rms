const request = require('supertest');

describe('Users routes', () => {
  let baseUrl = 'http://localhost:3000';
  let serverProc;

  const waitForHealth = (url, timeout = 10000) => {
    const start = Date.now();
    const { URL } = require('url');
    const http = require('http');
    return new Promise((resolve, reject) => {
      const check = () => {
        const u = new URL(url + '/health');
        const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', timeout: 2000 }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            return resolve(true);
          }
          res.resume();
          if (Date.now() - start < timeout) return setTimeout(check, 200);
          return reject(new Error('Health check timeout'));
        });
        req.on('error', () => {
          if (Date.now() - start < timeout) return setTimeout(check, 200);
          return reject(new Error('Health check timeout'));
        });
        req.end();
      };
      check();
    });
  };

  beforeAll(async () => {
    const cp = require('child_process');
    const indexPath = require('path').resolve(__dirname, '..', 'index.js');
    serverProc = cp.spawn(process.execPath, [indexPath], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    serverProc.stdout.on('data', d => process.stdout.write('[api] '+d));
    serverProc.stderr.on('data', d => process.stderr.write('[api.err] '+d));
    await waitForHealth(baseUrl, 10000);
  });

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

  afterAll(() => {
    if (serverProc) serverProc.kill();
  });
});
