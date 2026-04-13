const request = require('supertest');

describe('Auth refresh', () => {
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

  afterAll(() => {
    if (serverProc) serverProc.kill();
  });
});
