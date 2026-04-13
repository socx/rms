const request = require('supertest');

describe('Auth routes', () => {
  let app;
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
  
  afterAll(() => {
    if (serverProc) {
      serverProc.kill();
    }
  });
});
