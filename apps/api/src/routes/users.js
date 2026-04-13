import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, fail, forbidden, notFound } from '../utils/response.js';

export const usersRouter = Router();

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
