import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, fail, notFound } from '../utils/response.js';

export const adminRouter = Router();

// GET /admin/settings
adminRouter.get('/settings', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
		return ok(res, { settings });
	} catch (e) { next(e); }
});

// PATCH /admin/settings/:key
adminRouter.patch('/settings/:key', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const { key } = req.params;
		const { value } = req.body || {};
		if (value === undefined) return fail(res, 'INVALID_PAYLOAD', 'value is required.', 400);

		const existing = await prisma.systemSetting.findUnique({ where: { key } });
		if (!existing) return notFound(res, 'Setting not found.');

		// Basic per-key validation
		if (key === 'dispatch_poll_interval_seconds') {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 10 || num > 3600)
				return fail(res, 'INVALID_VALUE', 'dispatch_poll_interval_seconds must be integer between 10 and 3600.', 400);
		}
		if (key === 'allow_public_registration') {
			const s = String(value).toLowerCase();
			if (s !== 'true' && s !== 'false') return fail(res, 'INVALID_VALUE', 'allow_public_registration must be true or false.', 400);
		}

		const updated = await prisma.systemSetting.update({
			where: { key },
			data: { value: String(value), updatedById: req.user.id },
			select: { key: true, value: true, description: true, updatedAt: true, updatedById: true }
		});

		return ok(res, { setting: updated });
	} catch (e) { next(e); }
});

// GET /admin/users
// Supports optional query: q (email or name fragment), limit, offset
adminRouter.get('/users', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const q = (req.query.q || '').trim();
		const limit = Math.min(100, Number(req.query.limit) || 100);
		const offset = Number(req.query.offset) || 0;

		const where = q ? {
			OR: [
				{ email: { contains: q, mode: 'insensitive' } },
				{ firstname: { contains: q, mode: 'insensitive' } },
				{ lastname: { contains: q, mode: 'insensitive' } },
			]
		} : {};

		const users = await prisma.user.findMany({
			where,
			take: limit,
			skip: offset,
			orderBy: { createdAt: 'desc' },
			select: { id: true, firstname: true, lastname: true, email: true, systemRole: true, status: true, createdAt: true }
		});

		return ok(res, { users });
	} catch (e) { next(e); }
});

// GET /admin/users/:id
adminRouter.get('/users/:id', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const { id } = req.params;
		const user = await prisma.user.findUnique({
			where: { id },
			select: { id: true, firstname: true, lastname: true, email: true, phone: true, timezone: true, systemRole: true, status: true, emailVerified: true, createdAt: true }
		});
		if (!user) return notFound(res, 'User not found.');
		return ok(res, { user });
	} catch (e) { next(e); }
});

// PATCH /admin/users/:id
adminRouter.patch('/users/:id', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (id === req.user.id)
			return fail(res, 'SELF_MODIFY', 'Cannot modify your own account via admin endpoint.', 400);

		const existing = await prisma.user.findUnique({ where: { id } });
		if (!existing) return notFound(res, 'User not found.');

		const { status, systemRole } = req.body || {};
		const data = {};

		if (status !== undefined) {
			const s = String(status).toUpperCase();
			if (!['ACTIVE', 'DISABLED'].includes(s))
				return fail(res, 'INVALID_STATUS', 'status must be one of: ACTIVE, DISABLED.', 400);
			data.status = s;
		}

		if (systemRole !== undefined) {
			const r = String(systemRole).toUpperCase();
			if (!['USER', 'SYSTEM_ADMIN'].includes(r))
				return fail(res, 'INVALID_ROLE', 'systemRole must be one of: USER, SYSTEM_ADMIN.', 400);
			data.systemRole = r;
		}

		if (Object.keys(data).length === 0)
			return fail(res, 'INVALID_PAYLOAD', 'status or systemRole is required.', 400);

		const user = await prisma.user.update({
			where: { id },
			data,
			select: { id: true, firstname: true, lastname: true, email: true, phone: true, timezone: true, systemRole: true, status: true, emailVerified: true, createdAt: true }
		});

		return ok(res, { user });
	} catch (e) { next(e); }
});

// GET /admin/events — paginated cross-user event list
adminRouter.get('/events', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const page    = Math.max(1, Number(req.query.page) || 1);
		const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 20));
		const q       = (req.query.q || '').trim();

		const where = q ? {
			OR: [
				{ subject: { contains: q, mode: 'insensitive' } },
				{ owner: { email: { contains: q, mode: 'insensitive' } } },
			]
		} : {};

		const [events, total] = await Promise.all([
			prisma.event.findMany({
				where,
				take: perPage,
				skip: (page - 1) * perPage,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					subject: true,
					status: true,
					eventDatetime: true,
					location: true,
					createdAt: true,
					owner: { select: { id: true, firstname: true, lastname: true, email: true } }
				}
			}),
			prisma.event.count({ where })
		]);

		return ok(res, { events }, { page, per_page: perPage, total });
	} catch (e) { next(e); }
});
