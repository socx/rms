import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { created, conflict, fail, forbidden } from '../utils/response.js';

export const authRouter = Router();

// POST /auth/register
authRouter.post('/register', async (req, res, next) => {
	try {
		const { firstname, lastname, email, password, timezone } = req.body || {};
		if (!firstname || !lastname || !email || !password) {
			return fail(res, 'INVALID_PAYLOAD', 'firstname, lastname, email and password are required.', 400);
		}

		// Basic email validation
		const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
		if (!emailRe.test(email)) return fail(res, 'INVALID_EMAIL', 'Email address is not valid.', 400);

		if (password.length < 8) return fail(res, 'WEAK_PASSWORD', 'Password must be at least 8 characters.', 400);

		// Check system setting to allow public registration
		const setting = await prisma.systemSetting.findUnique({ where: { key: 'allow_public_registration' } });
		if (!setting || setting.value !== 'true') return forbidden(res, 'Public registration is disabled.');

		// Ensure email isn't already registered
		const existing = await prisma.user.findUnique({ where: { email } });
		if (existing) return conflict(res, 'EMAIL_EXISTS', 'An account with that email already exists.');

		const passwordHash = await bcrypt.hash(password, 12);

		const user = await prisma.user.create({
			data: {
				firstname,
				lastname,
				email,
				passwordHash,
				timezone: timezone || 'UTC',
			},
			select: { id: true, firstname: true, lastname: true, email: true, timezone: true, createdAt: true }
		});

		// Create email verification token (raw token is emailed to user by background job)
		const rawToken = crypto.randomBytes(32).toString('hex');
		const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
		const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
		await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt: expires } });

		// NOTE: We do not return the raw verification token in the API response.
		return created(res, { message: 'Account created. Please check your email to verify your address.' });
	} catch (e) { next(e); }
});

// POST /auth/login
authRouter.post('/login', async (req, res, next) => {
	try {
		const { email, password } = req.body || {};
		if (!email || !password) return fail(res, 'INVALID_PAYLOAD', 'email and password are required.', 400);

		const user = await prisma.user.findUnique({ where: { email } });
		if (!user) return fail(res, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
		if (user.status !== 'active') return fail(res, 'ACCOUNT_DISABLED', 'Account is not active.', 403);
		if (!user.emailVerified) return fail(res, 'EMAIL_NOT_VERIFIED', 'Please verify your email.', 403);

		const ok = await bcrypt.compare(password, user.passwordHash);
		if (!ok) return fail(res, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);

		// Create JWT
		const token = jwt.sign({ sub: user.id, role: user.systemRole }, process.env.JWT_SECRET, { expiresIn: '7d' });

		return ok ? created(res, { token, user: { id: user.id, email: user.email, firstname: user.firstname, lastname: user.lastname, timezone: user.timezone } }) : fail(res, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
	} catch (e) { next(e); }
});
