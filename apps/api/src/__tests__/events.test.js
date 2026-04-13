const request = require('supertest');
const cp = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Events API', () => {
  let baseUrl = 'http://localhost:3000';
  let serverProc;

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

  test('create -> get -> patch -> delete event flow', async () => {
    const email = `evuser+${Date.now()%100000}@example.com`;
    const pw = 'Password01';

    const r = await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'E', lastname: 'User', email, password: pw, timezone: 'UTC' }).set('Accept', 'application/json');
    expect(r.status).toBe(201);

    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('No DATABASE_URL available for psql');

    // verify user so operations proceed
    const promoteSql = `UPDATE users SET email_verified=true, email_verified_at=now() WHERE email='${email}';`;
    cp.execSync(`psql "${conn}" -t -c "${promoteSql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });

    const out = cp.execSync(`psql "${conn}" -t -c "SELECT id FROM users WHERE email='${email}' LIMIT 1;"`, { encoding: 'utf8' });
    const userId = out.trim();
    const token = jwt.sign({ sub: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Create event
    const dt = new Date(Date.now() + 3600 * 1000).toISOString();
    const create = await request(baseUrl).post('/api/v1/events').set('Authorization', `Bearer ${token}`).send({ subject: 'Test Event', eventDatetime: dt, eventTimezone: 'UTC' }).set('Accept', 'application/json');
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;

    // Get event
    const g = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(g.status).toBe(200);
    expect(g.body.data.event).toHaveProperty('id', eventId);

    // Patch event
    const p = await request(baseUrl).patch(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).send({ subject: 'Updated Subject' }).set('Accept', 'application/json');
    expect(p.status).toBe(200);
    expect(p.body.data.event).toHaveProperty('subject', 'Updated Subject');

    // Delete (archive)
    const d = await request(baseUrl).delete(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(d.status).toBe(200);
    expect(d.body.data.event).toHaveProperty('status');

    // After archive, GET should return 404 for non-admin
    const g2 = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');
    expect(g2.status).toBe(404);
  }, 30000);
});
