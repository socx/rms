const request = require('supertest');
const cp = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const jwt = require('jsonwebtoken');

describe('Events access control', () => {
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

  test('requireEventRole enforces access: only owner or granted roles can view', async () => {
    const ownerEmail = `owner+${Date.now()%100000}@example.com`;
    const otherEmail = `other+${Date.now()%100000}@example.com`;
    const pw = 'Password01';

    // Register owner and other user
    await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'Owner', lastname: 'One', email: ownerEmail, password: pw, timezone: 'UTC' });
    await request(baseUrl).post('/api/v1/auth/register').send({ firstname: 'Other', lastname: 'Two', email: otherEmail, password: pw, timezone: 'UTC' });

    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('No DATABASE_URL available for psql');

    // Verify both users
    cp.execSync(`psql "${conn}" -t -c "UPDATE users SET email_verified=true, email_verified_at=now() WHERE email IN ('${ownerEmail}','${otherEmail}');"`, { encoding: 'utf8' });

    const ownerId = cp.execSync(`psql "${conn}" -t -c "SELECT id FROM users WHERE email='${ownerEmail}' LIMIT 1;"`, { encoding: 'utf8' }).trim();
    const otherId = cp.execSync(`psql "${conn}" -t -c "SELECT id FROM users WHERE email='${otherEmail}' LIMIT 1;"`, { encoding: 'utf8' }).trim();

    const ownerToken = jwt.sign({ sub: ownerId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const otherToken = jwt.sign({ sub: otherId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Owner creates an event
    const dt = new Date(Date.now() + 3600 * 1000).toISOString();
    const create = await request(baseUrl).post('/api/v1/events').set('Authorization', `Bearer ${ownerToken}`).send({ subject: 'Owner Event', eventDatetime: dt, eventTimezone: 'UTC' }).set('Accept', 'application/json');
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;

    // Other user should be forbidden
    const g = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(g.status).toBe(403);

    // Grant reader access to other user via DB
    cp.execSync(`psql "${conn}" -t -c "INSERT INTO event_access (event_id, user_id, role, granted_by_id) VALUES ('${eventId}','${otherId}','reader','${ownerId}');"`, { encoding: 'utf8' });

    // Now other user can GET
    const g2 = await request(baseUrl).get(`/api/v1/events/${eventId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(g2.status).toBe(200);

    // Cleanup: remove access via DB (teardown will remove users/events)
  }, 30000);
});
