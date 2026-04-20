import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve env files relative to this file's location so the correct repo-root
// .env is loaded regardless of what process.cwd() is (e.g. when started via
// `npm run dev --workspace=apps/api`, cwd is apps/api, not the repo root).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// Load .env first, then fall back to .env.dev when DATABASE_URL is missing.
dotenv.config({ path: path.join(repoRoot, '.env') });
if (!process.env.DATABASE_URL) {
	dotenv.config({ path: path.join(repoRoot, '.env.dev') });
}
import express from 'express';
import fs from 'fs';
import https from 'https';
import helmet from 'helmet';
import cors from 'cors';
import { authRouter }        from './routes/auth.js';
import { usersRouter }       from './routes/users.js';
import { apiKeysRouter }     from './routes/apiKeys.js';
import { eventsRouter }      from './routes/events.js';
import { remindersRouter }   from './routes/reminders.js';
import { subscribersRouter } from './routes/subscribers.js';
import { adminRouter }       from './routes/admin.js';
import { rateLimiter }       from './middleware/rateLimiter.js';
import { errorHandler }      from './middleware/errorHandler.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.APP_DOMAIN, credentials: true }));
app.use(express.json());
app.use('/api/v1', rateLimiter);
app.use('/api/v1/auth',   authRouter);
app.use('/api/v1/users',  usersRouter);
app.use('/api/v1/users',  apiKeysRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/events', remindersRouter);
app.use('/api/v1/events', subscribersRouter);
app.use('/api/v1/admin',  adminRouter);
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_PORT = process.env.SSL_PORT || PORT;
const SSL_PORT_FILE = (() => {
	if (process.env.SSL_PORT_FILE) return process.env.SSL_PORT_FILE;
	// Try to locate repo root (a package.json with "workspaces") upwards from cwd
	let cur = process.cwd();
	for (let i = 0; i < 5; i++) {
		try {
			const pj = path.resolve(cur, 'package.json');
			if (fs.existsSync(pj)) {
				const json = JSON.parse(fs.readFileSync(pj, 'utf8'));
				if (json && (json.workspaces || json.name === 'rms')) {
					return path.resolve(cur, 'infra', 'dev-certs', 'ssl_port.txt');
				}
			}
		} catch (e) {
			// ignore
		}
		const parent = path.resolve(cur, '..');
		if (parent === cur) break;
		cur = parent;
	}
	// fallback to repo-relative path from current cwd
	return path.resolve('infra', 'dev-certs', 'ssl_port.txt');
})();

const writeSslPortFile = (port) => {
	try {
		fs.writeFileSync(SSL_PORT_FILE, String(port) + '\n');
	} catch (e) {
		console.warn('Failed to write SSL port file:', e);
	}
};

if (SSL_KEY_PATH && SSL_CERT_PATH) {
	try {
		const key = fs.readFileSync(SSL_KEY_PATH);
		const cert = fs.readFileSync(SSL_CERT_PATH);
		const server = https.createServer({ key, cert }, app);

		// If the requested SSL port is busy, attempt to bind to an ephemeral port instead of failing.
		let attemptedEphemeral = false;
		server.on('error', (err) => {
			if (err && err.code === 'EADDRINUSE' && !attemptedEphemeral) {
				attemptedEphemeral = true;
				console.warn(`Requested SSL port ${SSL_PORT} is in use — attempting an ephemeral port instead.`);
				try {
					server.listen(0, () => {
							const addr = server.address();
							console.log(`RMS API listening (https) on port ${addr.port} (auto-selected)`);
							writeSslPortFile(addr.port);
						});
					return;
				} catch (e) {
					console.error('Failed to bind to an ephemeral SSL port, falling back to HTTP:', e);
				}
			}

			// Any other error or if ephemeral bind failed: fall back to HTTP.
				console.warn('HTTPS server error, falling back to HTTP:', err);
			if (!app.locals._httpStarted) {
				app.locals._httpStarted = true;
				app.listen(PORT, () => console.log(`RMS API listening on port ${PORT}`));
			}
		});

		server.listen(SSL_PORT, () => {
			const addr = server.address();
			const bound = addr && addr.port ? addr.port : SSL_PORT;
			console.log(`RMS API listening (https) on port ${bound}`);
			writeSslPortFile(bound);
		});
	} catch (err) {
		console.info('Dev SSL files not present; starting HTTP server instead.');
		const httpServer = app.listen(PORT, () => {
			const addr = httpServer.address();
			const bound = addr && addr.port ? addr.port : PORT;
			console.log(`RMS API listening on port ${bound}`);
		});
	}
} else {
	const httpServer = app.listen(PORT, () => {
		const addr = httpServer.address();
		const bound = addr && addr.port ? addr.port : PORT;
		console.log(`RMS API listening on port ${bound}`);
	});
}

export default app;
