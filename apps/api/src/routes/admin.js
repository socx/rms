import { Router } from 'express';
import { authenticate, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, fail, notFound } from '../utils/response.js';
import fs from 'fs';
import path from 'path';
import { writeAudit, getIp } from '../utils/audit.js';

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

		const callerRole = String(req.user.systemRole).toLowerCase();
		const targetRole = String(existing.systemRole).toLowerCase();

		// system_admin cannot modify another system_admin or super_admin; only super_admin can
		if (callerRole === 'system_admin' && (targetRole === 'system_admin' || targetRole === 'super_admin'))
			return fail(res, 'FORBIDDEN', 'Only super_admin can modify other admin accounts.', 403);

		if (status !== undefined) {
			const s = String(status).toUpperCase();
			if (!['ACTIVE', 'DISABLED'].includes(s))
				return fail(res, 'INVALID_STATUS', 'status must be one of: ACTIVE, DISABLED.', 400);
			data.status = s;
		}

		if (systemRole !== undefined) {
			const r = String(systemRole).toUpperCase();
			const allowed = callerRole === 'super_admin'
				? ['USER', 'SYSTEM_ADMIN', 'SUPER_ADMIN']
				: ['USER', 'SYSTEM_ADMIN'];
			if (!allowed.includes(r))
				return fail(res, 'INVALID_ROLE', `systemRole must be one of: ${allowed.join(', ')}.`, 400);
			// Prevent setting super_admin unless caller IS super_admin
			if (r === 'SUPER_ADMIN' && callerRole !== 'super_admin')
				return fail(res, 'FORBIDDEN', 'Only super_admin can promote to super_admin.', 403);
			data.systemRole = r;
		}

		if (Object.keys(data).length === 0)
			return fail(res, 'INVALID_PAYLOAD', 'status or systemRole is required.', 400);

		const user = await prisma.user.update({
			where: { id },
			data,
			select: { id: true, firstname: true, lastname: true, email: true, phone: true, timezone: true, systemRole: true, status: true, emailVerified: true, createdAt: true }
		});

		writeAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'UPDATE', entityType: 'USER', entityId: id, entitySummary: user.email, changes: data, ipAddress: getIp(req) });
		return ok(res, { user });
	} catch (e) { next(e); }
});

// DELETE /admin/users/:id — soft-delete (super_admin only)
adminRouter.delete('/users/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
	try {
		const { id } = req.params;
		if (id === req.user.id)
			return fail(res, 'SELF_MODIFY', 'Cannot delete your own account.', 400);
		const existing = await prisma.user.findUnique({ where: { id } });
		if (!existing) return notFound(res, 'User not found.');
		const user = await prisma.user.update({
			where: { id },
			data: { status: 'DELETED' },
			select: { id: true, status: true }
		});
		writeAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'DELETE', entityType: 'USER', entityId: id, entitySummary: existing.email, ipAddress: getIp(req) });
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/audit-logs  — admin+
// Query: entity_type, actor_id, action, date_from, date_to, limit, offset
// ─────────────────────────────────────────────────────────────────────────────
adminRouter.get('/audit-logs', authenticate, requireAdmin, async (req, res, next) => {
	try {
		const limit    = Math.min(500, Number(req.query.limit) || 100);
		const offset   = Number(req.query.offset) || 0;
		const where    = {};
		if (req.query.entity_type) where.entityType = String(req.query.entity_type).toUpperCase();
		if (req.query.actor_id)    where.actorId    = req.query.actor_id;
		if (req.query.action)      where.action     = String(req.query.action).toUpperCase();
		if (req.query.date_from || req.query.date_to) {
			where.createdAt = {};
			if (req.query.date_from) where.createdAt.gte = new Date(req.query.date_from);
			if (req.query.date_to)   where.createdAt.lte = new Date(req.query.date_to);
		}

		const [logs, total] = await Promise.all([
			prisma.auditLog.findMany({
				where,
				take: limit,
				skip: offset,
				orderBy: { createdAt: 'desc' },
			}),
			prisma.auditLog.count({ where }),
		]);

		return ok(res, { logs }, { limit, offset, total });
	} catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/logs  — super_admin only
// Query: tier (api|worker), stream (out|error), lines (max 1000, default 200)
// Reads the last N lines from the configured log file.
// ─────────────────────────────────────────────────────────────────────────────
const LOG_PATHS = {
	api:    { out: '/var/log/rms/api-out.log',    error: '/var/log/rms/api-error.log'    },
	worker: { out: '/var/log/rms/worker-out.log', error: '/var/log/rms/worker-error.log' },
};

adminRouter.get('/logs', authenticate, requireSuperAdmin, async (req, res, next) => {
	try {
		const tier   = String(req.query.tier   || 'api').toLowerCase();
		const stream = String(req.query.stream || 'out').toLowerCase();
		const lines  = Math.min(1000, Math.max(1, Number(req.query.lines) || 200));

		if (!LOG_PATHS[tier])
			return fail(res, 'INVALID_TIER', 'tier must be one of: api, worker.', 400);
		if (!LOG_PATHS[tier][stream])
			return fail(res, 'INVALID_STREAM', 'stream must be one of: out, error.', 400);

		const filePath = LOG_PATHS[tier][stream];

		if (!fs.existsSync(filePath))
			return ok(res, { tier, stream, lines: [], message: 'Log file does not exist yet.' });

		const content = fs.readFileSync(filePath, 'utf8');
		const allLines = content.split('\n').filter(l => l.trim());
		const tail = allLines.slice(-lines);

		return ok(res, { tier, stream, path: filePath, lines: tail, total_lines: allLines.length });
	} catch (e) { next(e); }
});
