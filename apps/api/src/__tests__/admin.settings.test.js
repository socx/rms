const request = require('supertest');
const cp = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Admin settings API', () => {
  let baseUrl = 'http://localhost:3000';
  let serverProc;

  // Load repo .env.dev for psql usage
  try {
    const rootEnv = path.resolve(__dirname, '..', '..', '..', '..', '.env.dev');
    if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
  } catch (e) {}

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

  test('system_admin can list and update settings; non-admin forbidden', async () => {
    const adminEmail = `admin+${Date.now()%100000}@example.com`;
    const userEmail = `user+${Date.now()%100000}@example.com`;
    const pw = 'Password01';

    // Register normal user
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'U', lastname: 'User', email: userEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);

    // Register admin user
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'A', lastname: 'Admin', email: adminEmail, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('No DATABASE_URL available for psql');

    // Promote admin user and mark both users verified so tokens work
    const promoteSql = `UPDATE users SET system_role='system_admin', email_verified=true, email_verified_at=now() WHERE email='${adminEmail}';`;
    cp.execSync(`psql "${conn}" -t -c "${promoteSql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    const verifySql = `UPDATE users SET email_verified=true, email_verified_at=now() WHERE email='${userEmail}';`;
    cp.execSync(`psql "${conn}" -t -c "${verifySql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });

    // Get admin id
    const out = cp.execSync(`psql "${conn}" -t -c "SELECT id FROM users WHERE email='${adminEmail}' LIMIT 1;"`, { encoding: 'utf8' });
    const adminId = out.trim();
    expect(adminId.length).toBeGreaterThan(0);

    const adminToken = jwt.sign({ sub: adminId, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // GET settings as admin
    const g = await request(baseUrl).get('/api/v1/admin/settings').set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(g.status).toBe(200);
    expect(g.body.success).toBe(true);
    expect(Array.isArray(g.body.data.settings)).toBe(true);

    // Ensure there is a dispatch_poll_interval_seconds setting
    const found = g.body.data.settings.find(s => s.key === 'dispatch_poll_interval_seconds');
    expect(found).toBeDefined();

    // PATCH with valid value
    const pGood = await request(baseUrl).patch('/api/v1/admin/settings/dispatch_poll_interval_seconds').set('Authorization', `Bearer ${adminToken}`).send({ value: 20 }).set('Accept', 'application/json');
    expect(pGood.status).toBe(200);
    expect(pGood.body.success).toBe(true);
    expect(pGood.body.data.setting).toHaveProperty('value');
    expect(String(pGood.body.data.setting.value)).toBe('20');

    // PATCH with invalid (too small)
    const pBad = await request(baseUrl).patch('/api/v1/admin/settings/dispatch_poll_interval_seconds').set('Authorization', `Bearer ${adminToken}`).send({ value: 5 }).set('Accept', 'application/json');
    expect(pBad.status).toBe(400);

    // Non-admin attempt -> forbidden
    // Get non-admin id
    const out2 = cp.execSync(`psql "${conn}" -t -c "SELECT id FROM users WHERE email='${userEmail}' LIMIT 1;"`, { encoding: 'utf8' });
    const userId = out2.trim();
    const userToken = jwt.sign({ sub: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    const g2 = await request(baseUrl).get('/api/v1/admin/settings').set('Authorization', `Bearer ${userToken}`).set('Accept', 'application/json');
    expect(g2.status).toBe(403);
  }, 30000);
});
