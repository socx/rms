// Loaded by Jest setupFiles before every test module.
// Tries .env first, then .env.dev, so tests work regardless of which file exists.
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
for (const name of ['.env', '.env.dev']) {
  const envPath = path.join(repoRoot, name);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
    break;
  }
}
