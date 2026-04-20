import { Router } from 'express';
import bcrypt from 'bcrypt';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, created, fail, forbidden, notFound, conflict } from '../utils/response.js';

export const usersRouter = Router();

// POST /users  — system_admin creates a user directly (pre-verified)
usersRouter.post('/', authenticate, async (req, res, next) => {
	try {
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res, 'system_admin role required.');

		const { firstname, lastname, email, password, timezone, phone, systemRole } = req.body || {};
		if (!firstname || !lastname || !email || !password)
			return fail(res, 'INVALID_PAYLOAD', 'firstname, lastname, email and password are required.', 400);

		const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
		if (!emailRe.test(email)) return fail(res, 'INVALID_EMAIL', 'Email address is not valid.', 400);
		if (password.length < 8) return fail(res, 'WEAK_PASSWORD', 'Password must be at least 8 characters.', 400);

		const existing = await prisma.user.findUnique({ where: { email } });
		if (existing) return conflict(res, 'EMAIL_EXISTS', 'An account with that email already exists.');

		const allowedRoles = ['USER', 'SYSTEM_ADMIN'];
		const role = systemRole ? String(systemRole).toUpperCase() : 'USER';
		if (!allowedRoles.includes(role))
			return fail(res, 'INVALID_ROLE', `systemRole must be one of: ${allowedRoles.join(', ')}.`, 400);

		const passwordHash = await bcrypt.hash(password, 12);
		const now = new Date();

		const user = await prisma.user.create({
			data: {
				firstname,
				lastname,
				email,
				passwordHash,
				timezone: timezone || 'UTC',
				...(phone ? { phone } : {}),
				systemRole: role,
				emailVerified: true,
				emailVerifiedAt: now,
			},
			select: { id: true, firstname: true, lastname: true, email: true, phone: true, timezone: true, systemRole: true, status: true, emailVerified: true, createdAt: true },
		});

		return created(res, { user });
	} catch (e) { next(e); }
});

// GET /users/:id
usersRouter.get('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		// allow users to fetch their own profile or admins to fetch any
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res, 'Insufficient permissions.');

		const user = await prisma.user.findUnique({ where: { id }, select: { id: true, firstname: true, lastname: true, email: true, timezone: true, createdAt: true, emailVerified: true, systemRole: true, status: true } });
		if (!user) return notFound(res, 'User not found.');
		return ok(res, { user });
	} catch (e) { next(e); }
});

// PATCH /users/:id
usersRouter.patch('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res, 'Insufficient permissions.');

		const { firstname, lastname, timezone } = req.body || {};
		const data = {};
		if (typeof firstname === 'string') data.firstname = firstname;
		if (typeof lastname === 'string') data.lastname = lastname;
		if (typeof timezone === 'string') data.timezone = timezone;

		if (Object.keys(data).length === 0) return fail(res, 'INVALID_PAYLOAD', 'No allowed fields to update provided.', 400);

		const user = await prisma.user.update({ where: { id }, data, select: { id: true, firstname: true, lastname: true, email: true, timezone: true, updatedAt: true } });
		return ok(res, { user });
	} catch (e) { next(e); }
});

// POST /users/:id/disable
usersRouter.post('/:id/disable', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		// Only system_admin may disable users
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin') return forbidden(res, 'system_admin role required.');
		if (req.user.id === id) return fail(res, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account.', 400);

		const exists = await prisma.user.findUnique({ where: { id } });
		if (!exists) return notFound(res, 'User not found.');

		const user = await prisma.user.update({ where: { id }, data: { status: 'DISABLED' }, select: { id: true, status: true } });
		return ok(res, { user });
	} catch (e) { next(e); }
});

// POST /users/:id/enable
usersRouter.post('/:id/enable', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		// Only system_admin may enable users
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin') return forbidden(res, 'system_admin role required.');

		const exists = await prisma.user.findUnique({ where: { id } });
		if (!exists) return notFound(res, 'User not found.');

		const user = await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true, status: true } });
		return ok(res, { user });
	} catch (e) { next(e); }
});

// DELETE /users/:id
usersRouter.delete('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		// Only system_admin may delete users
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin') return forbidden(res, 'system_admin role required.');
		if (req.user.id === id) return fail(res, 'CANNOT_DELETE_SELF', 'You cannot delete your own account.', 400);

		const exists = await prisma.user.findUnique({ where: { id } });
		if (!exists) return notFound(res, 'User not found.');

		// Soft-delete by setting status to DELETED
		const user = await prisma.user.update({ where: { id }, data: { status: 'DELETED' }, select: { id: true, status: true } });
		return ok(res, { user });
	} catch (e) { next(e); }
});

// ── Email wrapper routes ──────────────────────────────────────────────────

const EMAIL_WRAPPER_SELECT = { id: true, ownerId: true, wrapperHtml: true, isActive: true, createdAt: true, updatedAt: true };

// GET /users/:id/email-wrapper
usersRouter.get('/:id/email-wrapper', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res);

		const wrapper = await prisma.emailWrapperSetting.findUnique({ where: { ownerId: id }, select: EMAIL_WRAPPER_SELECT });
		if (!wrapper) return notFound(res, 'No custom email wrapper set for this user.');
		return ok(res, { emailWrapper: wrapper });
	} catch (e) { next(e); }
});

// PUT /users/:id/email-wrapper  — create or fully replace
usersRouter.put('/:id/email-wrapper', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res);

		const { wrapperHtml, isActive } = req.body || {};
		if (!wrapperHtml || typeof wrapperHtml !== 'string')
			return fail(res, 'INVALID_PAYLOAD', 'wrapperHtml is required.', 400);
		if (!wrapperHtml.includes('{{body}}'))
			return fail(res, 'MISSING_BODY_PLACEHOLDER', 'wrapperHtml must contain exactly one {{body}} placeholder.', 400);

		const user = await prisma.user.findUnique({ where: { id } });
		if (!user) return notFound(res, 'User not found.');

		const wrapper = await prisma.emailWrapperSetting.upsert({
			where: { ownerId: id },
			create: { ownerId: id, wrapperHtml, isActive: isActive !== false },
			update: { wrapperHtml, isActive: isActive !== false },
			select: EMAIL_WRAPPER_SELECT,
		});
		return ok(res, { emailWrapper: wrapper });
	} catch (e) { next(e); }
});

// PATCH /users/:id/email-wrapper  — partial update
usersRouter.patch('/:id/email-wrapper', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res);

		const existing = await prisma.emailWrapperSetting.findUnique({ where: { ownerId: id } });
		if (!existing) return notFound(res, 'No custom email wrapper set for this user.');

		const data = {};
		const { wrapperHtml, isActive } = req.body || {};
		if (typeof wrapperHtml === 'string') {
			if (!wrapperHtml.includes('{{body}}'))
				return fail(res, 'MISSING_BODY_PLACEHOLDER', 'wrapperHtml must contain exactly one {{body}} placeholder.', 400);
			data.wrapperHtml = wrapperHtml;
		}
		if (typeof isActive === 'boolean') data.isActive = isActive;

		if (Object.keys(data).length === 0)
			return fail(res, 'INVALID_PAYLOAD', 'No valid fields provided to update.', 400);

		const wrapper = await prisma.emailWrapperSetting.update({ where: { ownerId: id }, data, select: EMAIL_WRAPPER_SELECT });
		return ok(res, { emailWrapper: wrapper });
	} catch (e) { next(e); }
});

// DELETE /users/:id/email-wrapper  — remove custom wrapper (reverts to system default)
usersRouter.delete('/:id/email-wrapper', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (req.user.id !== id && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res);

		const existing = await prisma.emailWrapperSetting.findUnique({ where: { ownerId: id } });
		if (!existing) return notFound(res, 'No custom email wrapper set for this user.');

		await prisma.emailWrapperSetting.delete({ where: { ownerId: id } });
		return ok(res, { message: 'Custom email wrapper removed. System default will be used.' });
	} catch (e) { next(e); }
});
