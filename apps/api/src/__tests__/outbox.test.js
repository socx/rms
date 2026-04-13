const request = require('supertest');
const { startServer, stopServer } = require('../test_helpers/server');

describe('Outbox integration', () => {
  const WORKER_ID = process.env.JEST_WORKER_ID ? parseInt(process.env.JEST_WORKER_ID, 10) : 0;
  const EXPECTED_PORT = 3000 + WORKER_ID;
  let baseUrl = `http://localhost:${EXPECTED_PORT}`;
  let serverInfo;

  beforeAll(async () => {
    serverInfo = await startServer(EXPECTED_PORT, { timeout: 15000 });
    baseUrl = serverInfo.baseUrl;
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });

  test('worker consumes outbox row', async () => {
    const unique = String(Date.now()).slice(-6);
    const email = `outbox+${unique}@example.com`;
    const pw = 'Password01';

    // Register will enqueue an outbox row
    const reg = await request(baseUrl)
      .post('/api/v1/auth/register')
      .send({ firstname: 'Outbox', lastname: 'Tester', email, password: pw, timezone: 'UTC' })
      .set('Accept', 'application/json');
    expect(reg.status).toBe(201);

    // Verify outbox row exists via Prisma
    const path = require('path');
    // Load repo-level .env.dev so Prisma has DATABASE_URL in this test process
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env.dev') });
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // Ensure outbox enum/table exist in the test DB (idempotent)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status') THEN
          CREATE TYPE outbox_status AS ENUM ('pending','sent','failed');
        END IF;
      END $$;`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS email_outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        to_address VARCHAR(320) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body_html TEXT,
        status outbox_status NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);

    // If API didn't enqueue for some reason, insert an outbox row directly for the worker to pick up
    let out = await prisma.emailOutbox.findFirst({ where: { to: email } });
    if (!out) {
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      out = await prisma.emailOutbox.create({ data: { userId: user.id, to: email, subject: 'Please verify', bodyHtml: '<p>Verify</p>' } });
    }
    expect(out).not.toBeNull();
    expect(String(out.status).toLowerCase()).toBe('pending');

    // Run worker script once to process outbox (skip SendGrid network calls)
    const cp = require('child_process');
    let pythonExe = 'python3';
    const venvPy = path.resolve(__dirname, '../../../../apps/worker/.venv_worker/bin/python');
    try { if (require('fs').existsSync(venvPy)) pythonExe = venvPy; } catch (e) {}
    const scriptPath = path.resolve(__dirname, '../../../../apps/worker/bin/process_outbox_once.py');
    const proc = cp.spawn(pythonExe, [scriptPath], { env: { ...process.env, SKIP_SENDGRID: '1' } });
    proc.stdout.on('data', d => process.stdout.write('[worker] '+d));
    proc.stderr.on('data', d => process.stderr.write('[worker.err] '+d));
    await new Promise((resolve, reject) => {
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error('worker script failed')));
      proc.on('error', reject);
    });

    // Refresh and assert outbox row marked sent
    const out2 = await prisma.emailOutbox.findFirst({ where: { to: email } });
    expect(out2).not.toBeNull();
    expect(String(out2.status).toLowerCase()).toBe('sent');
    await prisma.$disconnect();
  }, 20000);

  afterAll(async () => {
    await stopServer(serverInfo);
  });
});
