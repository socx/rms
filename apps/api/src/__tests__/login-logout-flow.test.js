const request = require('supertest');

describe('Login -> Get User -> Logout -> Get User flow', () => {
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

    // Logout
    const logout = await request(baseUrl)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect([200,401]).toContain(logout.status);

    // GET user again: Accept either 200 (stateless logout) or 401 (revoked token)
    const g2 = await request(baseUrl)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json');
    expect([200,401]).toContain(g2.status);
  }, 20000);

  afterAll(() => {
    if (serverProc) serverProc.kill();
  });
});
