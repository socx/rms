#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const portFile = process.argv[2] || path.resolve('infra', 'dev-certs', 'ssl_port.txt');
const timeout = Number(process.argv[3] || 30000);
const interval = 200;

const start = Date.now();
const check = () => {
  if (fs.existsSync(portFile)) {
    const p = fs.readFileSync(portFile, 'utf8').trim();
    console.log(p);
    process.exit(0);
  }
  if (Date.now() - start > timeout) {
    console.error('Timed out waiting for', portFile);
    process.exit(2);
  }
  setTimeout(check, interval);
};

check();
