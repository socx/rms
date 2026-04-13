const request = require('supertest');
const cp = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Ensure test process has DATABASE_URL from repo root .env.dev when running from apps/api
let dbUrl = null;
try {
  // Resolve from this test file location up to repo root
  const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) {
      dotenv.config({ path: rootEnv, override: true });
      console.log('[test.setup] loaded env from', rootEnv);
    }
    // Also read DATABASE_URL directly from file for child psql usage
    let dbUrl = null;
    try {
      const envRaw = fs.readFileSync(rootEnv, 'utf8');
      const m = envRaw.match(/^DATABASE_URL=(.*)$/m);
      if (m) dbUrl = m[1].trim();
      console.log('[test.setup] dbUrl read?', !!dbUrl);
    } catch (e) {}
} catch (e) {
  // ignore
}

describe('regression: register -> verify -> login', () => {
  let serverProc;
  const baseUrl = 'http://localhost:3000';

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
    const indexPath = path.resolve(__dirname, '..', 'index.js');
    serverProc = cp.spawn(process.execPath, [indexPath], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    serverProc.stdout.on('data', d => process.stdout.write('[api] ' + d));
    serverProc.stderr.on('data', d => process.stderr.write('[api.err] ' + d));
    await waitForHealth(baseUrl, 15000);
  }, 20000);

  afterAll(() => {
    if (serverProc) serverProc.kill();
  });

  test('full flow: register -> verify -> login', async () => {
    const unique = String(Date.now()).slice(-8);
    const email = `regtest+${unique}@example.com`;
    const pw = 'Password01';

    // Register
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Reg', lastname: 'Test', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Wait briefly for outbox row to be created
    await new Promise(r => setTimeout(r, 500));

    // Query DB for the outbox body_html to extract the raw token
    const sql = `SELECT body_html FROM email_outbox WHERE to_address = '${email}' ORDER BY created_at DESC LIMIT 1;`;
    let out;
    try {
      const conn = dbUrl || process.env.DATABASE_URL;
      if (!conn) throw new Error('No DATABASE_URL available for psql');
      out = cp.execSync(`psql "${conn}" -t -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    } catch (e) {
      throw new Error('Failed to query email_outbox: ' + (e.stdout || e.message));
    }
    const html = out.trim();
    expect(html.length).toBeGreaterThan(0);

    const m = html.match(/verify-email\?token=([0-9a-fA-F]+)/);
    expect(m).not.toBeNull();
    const token = m[1];

    // Call verify endpoint
    const verify = await request(baseUrl).get('/api/v1/auth/verify-email').query({ token });
    expect([200,201]).toContain(verify.status);

    // Now login should succeed
    const login = await request(baseUrl).post('/api/v1/auth/login').send({ email, password: pw }).set('Accept', 'application/json');
    expect([200,201]).toContain(login.status);
    expect(login.body.success).toBe(true);
    expect(login.body.data).toHaveProperty('token');
  }, 30000);
});
