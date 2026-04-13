#!/usr/bin/env node
/* Cross-platform dev cert generator.
 * Tries to use `openssl` when available, falls back to `selfsigned` npm package.
 * Usage: node infra/scripts/generate-dev-certs.js [out-dir]
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const OUT_DIR = process.argv[2] || 'infra/dev-certs';
const KEY = path.join(OUT_DIR, 'dev.key');
const CRT = path.join(OUT_DIR, 'dev.crt');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function tryOpenSSL() {
  try {
    const which = spawnSync('openssl', ['version'], { encoding: 'utf8' });
    if (which.status !== 0) return false;
    const args = ['req','-x509','-nodes','-newkey','rsa:4096','-sha256','-days','365',
      '-subj','/CN=localhost',
      '-keyout', KEY, '-out', CRT];
    const res = spawnSync('openssl', args, { stdio: 'inherit' });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

async function fallbackSelfSigned() {
  try {
    // dynamic import to avoid hard dependency if openssl works
    const selfsigned = await import('selfsigned');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 365 });
    fs.writeFileSync(KEY, pems.private);
    fs.writeFileSync(CRT, pems.cert);
    return true;
  } catch (e) {
    console.error('selfsigned fallback failed:', e.message || e);
    return false;
  }
}

function printSuccess() {
  console.log(`Created development certs:\n  key: ${path.resolve(KEY)}\n  cert: ${path.resolve(CRT)}`);
  console.log('\nTo use them in your shell:');
  console.log(`  export SSL_KEY_PATH=${path.resolve(KEY)}`);
  console.log(`  export SSL_CERT_PATH=${path.resolve(CRT)}`);
  console.log('  export SSL_PORT=3443');
  console.log('\nThen start services:');
  console.log('  npm run dev');
}

async function main() {
  ensureDir(OUT_DIR);
  console.log('Generating dev certs in', OUT_DIR);
  const ok = tryOpenSSL();
  if (ok) {
    printSuccess();
    process.exit(0);
  }
  console.log('OpenSSL not available or failed — falling back to selfsigned npm package');
  const ok2 = await fallbackSelfSigned();
  if (ok2) {
    printSuccess();
    process.exit(0);
  }
  console.error('Failed to generate dev certificates. Install OpenSSL or add the `selfsigned` package.');
  process.exit(1);
}

main();
