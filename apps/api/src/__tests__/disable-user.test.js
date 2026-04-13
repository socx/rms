const request = require('supertest');
const cp = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Admin disable user', () => {
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

  test('admin can disable another user', async () => {
    const u1 = `target+${Date.now()%100000}@example.com`;
    const u2 = `admin+${Date.now()%100000}@example.com`;
    const pw = 'Password01';

    // Register target user
    const r1 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'T', lastname: 'User', email: u1, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r1.status).toBe(201);

    // Register admin user
    const r2 = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'A', lastname: 'Admin', email: u2, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r2.status).toBe(201);

    // Find admin id via psql
    const sql = `SELECT id FROM users WHERE email='${u2}' LIMIT 1;`;
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('No DATABASE_URL available for psql');
    const out = cp.execSync(`psql "${conn}" -t -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    const adminId = out.trim();
    expect(adminId.length).toBeGreaterThan(0);

    // Create admin JWT directly (no need to login/verify)
    // Promote admin user in DB so middleware recognizes system_role and email_verified
    const promoteSql = `UPDATE users SET system_role='system_admin', email_verified=true, email_verified_at=now() WHERE id='${adminId}';`;
    cp.execSync(`psql "${conn}" -t -c "${promoteSql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });

    const adminToken = jwt.sign({ sub: adminId, role: 'system_admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Find target id
    const sql2 = `SELECT id FROM users WHERE email='${u1}' LIMIT 1;`;
    const out2 = cp.execSync(`psql "${conn}" -t -c "${sql2.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    const targetId = out2.trim();
    expect(targetId.length).toBeGreaterThan(0);

    // Disable target
    const disable = await request(baseUrl).post(`/api/v1/users/${targetId}/disable`).set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(disable.status).toBe(200);
    expect(disable.body.success).toBe(true);
    expect(disable.body.data.user).toHaveProperty('status');

    // Verify status via GET as admin
    const get = await request(baseUrl).get(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`).set('Accept', 'application/json');
    expect(get.status).toBe(200);
    expect(get.body.data.user).toHaveProperty('status');
    // DB-mapped status will be string; accept 'disabled' or DISABLED mapping depending on serializer
    const status = String(get.body.data.user.status).toLowerCase();
    expect(['disabled']).toContain(status);
  }, 30000);
});
