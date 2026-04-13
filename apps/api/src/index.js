import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import https from 'https';
import helmet from 'helmet';
import cors from 'cors';
import { authRouter }        from './routes/auth.js';
import { usersRouter }       from './routes/users.js';
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

if (SSL_KEY_PATH && SSL_CERT_PATH) {
	try {
		const key = fs.readFileSync(SSL_KEY_PATH);
		const cert = fs.readFileSync(SSL_CERT_PATH);
		https.createServer({ key, cert }, app).listen(SSL_PORT, () => console.log(`RMS API listening (https) on port ${SSL_PORT}`));
	} catch (err) {
		console.error('Failed to start HTTPS server, falling back to HTTP:', err);
		app.listen(PORT, () => console.log(`RMS API listening on port ${PORT}`));
	}
} else {
	app.listen(PORT, () => console.log(`RMS API listening on port ${PORT}`));
}

export default app;
