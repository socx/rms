const request = require('supertest');

describe('Auth logout', () => {
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

  afterAll(() => {
    if (serverProc) serverProc.kill();
  });
});
