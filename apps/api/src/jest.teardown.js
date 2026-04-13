const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load repo .env.dev if present (safe to attempt)
try {
  const rootEnv = path.resolve(__dirname, '..', '..', '..', '.env.dev');
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
} catch (e) {}

module.exports = async () => {
  const db = process.env.DATABASE_URL;
  if (!db) {
    console.warn('[jest.teardown] No DATABASE_URL found; skipping DB cleanup');
    return;
  }

  // Safety guard: only run cleanup against local/test DBs
  if (!/localhost|127\.0\.0\.1|:5432|rms_db/.test(db)) {
    console.warn('[jest.teardown] DATABASE_URL does not look local. Skipping cleanup:', db);
    return;
  }

  try {
    console.log('[jest.teardown] Cleaning test users and outbox entries');
    const sql = `BEGIN;
    -- Remove outbox and tokens
    DELETE FROM email_outbox WHERE to_address LIKE '%+%@%';
    DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%+%@%');
    DELETE FROM api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%+%@%');
    -- Remove event-related data for test users (safe ordering)
    DELETE FROM reminder_dispatches WHERE reminder_id IN (SELECT id FROM reminders WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%')));
    DELETE FROM reminder_reports WHERE reminder_id IN (SELECT id FROM reminders WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%')));
    DELETE FROM reminders WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%'));
    DELETE FROM subscriber_contacts WHERE subscriber_id IN (SELECT id FROM subscribers WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%')));
    DELETE FROM subscribers WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%'));
    DELETE FROM event_access WHERE event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%'));
    DELETE FROM events WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%+%@%');
    -- Finally, remove users
    DELETE FROM users WHERE email LIKE '%+%@%';
    COMMIT;`;
    execSync(`psql "${db}" -v ON_ERROR_STOP=1 -c "${sql.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    console.log('[jest.teardown] DB cleanup completed');
  } catch (e) {
    console.warn('[jest.teardown] Cleanup failed:', e.message || e);
  }
};
