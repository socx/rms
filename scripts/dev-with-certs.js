#!/usr/bin/env node
import { spawnSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Generate certs (blocking)
const gen = spawnSync(process.execPath, [path.join('scripts', 'generate-dev-certs.js')], { stdio: 'inherit' });
if (gen.status !== 0) process.exit(gen.status || 1);

const outDir = 'dev-certs';
const keyPath = path.resolve(outDir, 'dev.key');
const certPath = path.resolve(outDir, 'dev.crt');

const env = { ...process.env, SSL_KEY_PATH: keyPath, SSL_CERT_PATH: certPath, SSL_PORT: '3443' };
const portFile = process.env.SSL_PORT_FILE || path.resolve(outDir, 'ssl_port.txt');

console.log('Starting dev with SSL using:');
console.log('  SSL_KEY_PATH=', keyPath);
console.log('  SSL_CERT_PATH=', certPath);

// Spawn child and capture output so we can extract the actual HTTPS port (if auto-selected)
const child = spawn('npm', ['run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'], env });

const writePort = (port) => {
	try {
		fs.writeFileSync(portFile, String(port) + '\n');
		console.log(`Wrote SSL port ${port} to ${portFile}`);
	} catch (e) {
		console.warn('Failed to write SSL port file:', e);
	}
};

const portRegex = /RMS API listening \(https\) on port (\d+)/i;

child.stdout.on('data', (chunk) => {
	const text = chunk.toString();
	process.stdout.write(text);
	const m = portRegex.exec(text);
	if (m) writePort(m[1]);
});

child.stderr.on('data', (chunk) => {
	const text = chunk.toString();
	process.stderr.write(text);
	const m = portRegex.exec(text);
	if (m) writePort(m[1]);
});

child.on('exit', (code) => process.exit(code ?? 0));
