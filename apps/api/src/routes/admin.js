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
