import { Router } from 'express';
import { authenticate, requireEventRole } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, created, fail, notFound, forbidden } from '../utils/response.js';

export const eventsRouter = Router();

// POST /events - create event
eventsRouter.post('/', authenticate, async (req, res, next) => {
	try {
		const { subject, description, eventDatetime, eventTimezone, location } = req.body || {};
		if (!subject || !eventDatetime) return fail(res, 'INVALID_PAYLOAD', 'subject and eventDatetime are required.', 400);

		const event = await prisma.event.create({
			data: {
				subject,
				description: description || null,
				eventDatetime: new Date(eventDatetime),
				eventTimezone: eventTimezone || req.user.timezone || 'UTC',
				location: location || null,
				ownerId: req.user.id,
				createdById: req.user.id,
			},
			select: { id: true, ownerId: true, subject: true, description: true, eventDatetime: true, eventTimezone: true, location: true, status: true, createdAt: true }
		});

		return created(res, { event });
	} catch (e) { next(e); }
});

// GET /events - list events (admin-only sees all; normal users see owned or accessible)
eventsRouter.get('/', authenticate, async (req, res, next) => {
	try {
		const q        = (req.query.q || '').trim();
		const limit    = Math.min(100, Number(req.query.limit) || 50);
		const offset   = Number(req.query.offset) || 0;
		const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;
		const dateTo   = req.query.date_to   ? new Date(req.query.date_to)   : null;

		const where = {};
		if (q) where.OR = [
			{ subject: { contains: q, mode: 'insensitive' } },
			{ description: { contains: q, mode: 'insensitive' } },
		];
		if ((dateFrom && !isNaN(dateFrom)) || (dateTo && !isNaN(dateTo))) {
			where.eventDatetime = {};
			if (dateFrom && !isNaN(dateFrom)) where.eventDatetime.gte = dateFrom;
			if (dateTo   && !isNaN(dateTo))   where.eventDatetime.lte = dateTo;
		}

		// Non-admin: restrict to events owned by user or where user has access
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin') {
			// find event ids where user has access
			const accesses = await prisma.eventAccess.findMany({ where: { userId: req.user.id }, select: { eventId: true } });
			const accessibleIds = accesses.map(a => a.eventId);
			where.OR = where.OR ? [...where.OR, { ownerId: req.user.id }, { id: { in: accessibleIds } }] : [{ ownerId: req.user.id }, { id: { in: accessibleIds } }];
			// exclude archived/cancelled
			where.status = 'ACTIVE';
		}

		const events = await prisma.event.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' }, select: { id: true, ownerId: true, subject: true, eventDatetime: true, eventTimezone: true, status: true, createdAt: true } });
		return ok(res, { events });
	} catch (e) { next(e); }
});

// GET /events/:id
// Allowed: owner, any event access role (OWNER, CONTRIBUTOR, READER), or system_admin
eventsRouter.get('/:id', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		// If event not active, non-admins should see 404
		if (String(event.status).toLowerCase() !== 'active' && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return notFound(res, 'Event not found.');

		const ev = await prisma.event.findUnique({ where: { id }, include: { reminders: true, subscribers: true } });
		return ok(res, { event: ev });
	} catch (e) { next(e); }
});

// PATCH /events/:id - update event (owner or system_admin)
// PATCH /events/:id - update event (owner or system_admin)
eventsRouter.patch('/:id', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const { subject, description, eventDatetime, eventTimezone, location, status } = req.body || {};
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		const data = {};
		if (typeof subject === 'string') data.subject = subject;
		if (typeof description === 'string') data.description = description;
		if (eventDatetime) data.eventDatetime = new Date(eventDatetime);
		if (typeof eventTimezone === 'string') data.eventTimezone = eventTimezone;
		if (typeof location === 'string') data.location = location;
		if (typeof status === 'string') data.status = status;

		if (Object.keys(data).length === 0) return fail(res, 'INVALID_PAYLOAD', 'No updatable fields provided.', 400);

		const updated = await prisma.event.update({ where: { id }, data, select: { id: true, subject: true, description: true, eventDatetime: true, eventTimezone: true, location: true, status: true, updatedAt: true } });
		return ok(res, { event: updated });
	} catch (e) { next(e); }
});

// DELETE /events/:id - soft-delete (archive) (owner or system_admin)
// DELETE /events/:id - soft-delete (archive) (owner or system_admin)
eventsRouter.delete('/:id', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		const archived = await prisma.event.update({ where: { id }, data: { status: 'ARCHIVED' }, select: { id: true, status: true } });
		return ok(res, { event: archived });
	} catch (e) { next(e); }
});

// PATCH /events/:id/owner — reassign event owner (owner only)
eventsRouter.patch('/:id/owner', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const { newOwnerId } = req.body || {};
		if (!newOwnerId) return fail(res, 'INVALID_PAYLOAD', 'newOwnerId is required.', 400);

		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (event.ownerId === newOwnerId) return fail(res, 'ALREADY_OWNER', 'That user is already the event owner.', 400);

		const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId } });
		if (!newOwner || String(newOwner.status).toLowerCase() !== 'active')
			return fail(res, 'USER_NOT_FOUND', 'Target user not found or not active.', 400);

		// Transfer: update ownerId and remove any existing OWNER access row for the new owner,
		// then add/update access row for old owner as CONTRIBUTOR so they retain access.
		await prisma.$transaction(async (tx) => {
			await tx.event.update({ where: { id }, data: { ownerId: newOwnerId } });

			// Remove any EventAccess row the new owner may have (they are now the owner)
			await tx.eventAccess.deleteMany({ where: { eventId: id, userId: newOwnerId } });

			// Ensure old owner keeps CONTRIBUTOR access unless they already have a row
			const prevOwnerId = event.ownerId;
			if (prevOwnerId !== newOwnerId) {
				await tx.eventAccess.upsert({
					where: { eventId_userId: { eventId: id, userId: prevOwnerId } },
					create: { eventId: id, userId: prevOwnerId, role: 'CONTRIBUTOR', grantedById: newOwnerId },
					update: { role: 'CONTRIBUTOR' },
				});
			}
		});

		const updated = await prisma.event.findUnique({ where: { id }, select: { id: true, ownerId: true, subject: true, status: true, updatedAt: true } });
		return ok(res, { event: updated });
	} catch (e) { next(e); }
});

// POST /events/:id/cancel — cancel event and all scheduled/recurring reminders (owner only)
eventsRouter.post('/:id/cancel', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (String(event.status).toLowerCase() !== 'active')
			return fail(res, 'EVENT_NOT_ACTIVE', 'Only active events can be cancelled.', 400);

		await prisma.$transaction([
			prisma.event.update({ where: { id }, data: { status: 'CANCELLED' } }),
			prisma.reminder.updateMany({
				where: { eventId: id, status: { in: ['SCHEDULED', 'RECURRING'] } },
				data: { status: 'CANCELLED' },
			}),
		]);

		const updated = await prisma.event.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true } });
		return ok(res, { event: updated });
	} catch (e) { next(e); }
});

// POST /events/:id/unarchive — restore archived event (system_admin only)
eventsRouter.post('/:id/unarchive', authenticate, async (req, res, next) => {
	try {
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return forbidden(res, 'system_admin role required.');

		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (String(event.status).toLowerCase() !== 'archived')
			return fail(res, 'EVENT_NOT_ARCHIVED', 'Only archived events can be unarchived.', 400);

		const updated = await prisma.event.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true, status: true, updatedAt: true } });
		return ok(res, { event: updated });
	} catch (e) { next(e); }
});

// ── Event access management ───────────────────────────────────────────────

const ACCESS_SELECT = {
	id: true, eventId: true, userId: true, role: true, grantedById: true, createdAt: true,
	user: { select: { id: true, firstname: true, lastname: true, email: true } },
};

// GET /events/:id/access — list grants (owner only)
eventsRouter.get('/:id/access', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		const grants = await prisma.eventAccess.findMany({ where: { eventId: id }, select: ACCESS_SELECT, orderBy: { createdAt: 'asc' } });
		return ok(res, { grants });
	} catch (e) { next(e); }
});

// POST /events/:id/access — grant a role to a user (owner only)
eventsRouter.post('/:id/access', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id } = req.params;
		const { userId, role } = req.body || {};
		if (!userId || !role) return fail(res, 'INVALID_PAYLOAD', 'userId and role are required.', 400);

		const GRANTABLE_ROLES = ['CONTRIBUTOR', 'READER'];
		const normalRole = String(role).toUpperCase();
		if (!GRANTABLE_ROLES.includes(normalRole))
			return fail(res, 'INVALID_ROLE', `role must be one of: ${GRANTABLE_ROLES.join(', ')}.`, 400);

		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (event.ownerId === userId)
			return fail(res, 'USER_IS_OWNER', 'The event owner already has full access.', 400);

		const target = await prisma.user.findUnique({ where: { id: userId } });
		if (!target || String(target.status).toLowerCase() !== 'active')
			return fail(res, 'USER_NOT_FOUND', 'Target user not found or not active.', 400);

		const existing = await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
		if (existing) return fail(res, 'ACCESS_EXISTS', 'User already has access to this event. Use PATCH to change their role.', 409);

		const grant = await prisma.eventAccess.create({
			data: { eventId: id, userId, role: normalRole, grantedById: req.user.id },
			select: ACCESS_SELECT,
		});
		return created(res, { grant });
	} catch (e) { next(e); }
});

// PATCH /events/:id/access/:uid — change a user's event role (owner only)
eventsRouter.patch('/:id/access/:uid', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id, uid } = req.params;
		const { role } = req.body || {};

		const GRANTABLE_ROLES = ['CONTRIBUTOR', 'READER'];
		const normalRole = String(role || '').toUpperCase();
		if (!GRANTABLE_ROLES.includes(normalRole))
			return fail(res, 'INVALID_ROLE', `role must be one of: ${GRANTABLE_ROLES.join(', ')}.`, 400);

		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (event.ownerId === uid)
			return fail(res, 'CANNOT_CHANGE_OWNER_ROLE', 'Cannot change the event owner\'s role via this endpoint. Use PATCH /events/:id/owner to reassign ownership.', 400);

		const existing = await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: id, userId: uid } } });
		if (!existing) return notFound(res, 'Access grant not found.');

		const grant = await prisma.eventAccess.update({
			where: { eventId_userId: { eventId: id, userId: uid } },
			data: { role: normalRole },
			select: ACCESS_SELECT,
		});
		return ok(res, { grant });
	} catch (e) { next(e); }
});

// DELETE /events/:id/access/:uid — revoke a user's event access (owner only)
eventsRouter.delete('/:id/access/:uid', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
	try {
		const { id, uid } = req.params;

		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');
		if (event.ownerId === uid)
			return fail(res, 'CANNOT_REVOKE_OWNER', 'Cannot revoke the event owner\'s access. Reassign ownership first.', 400);

		const existing = await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: id, userId: uid } } });
		if (!existing) return notFound(res, 'Access grant not found.');

		await prisma.eventAccess.delete({ where: { eventId_userId: { eventId: id, userId: uid } } });
		return ok(res, { message: 'Access revoked.' });
	} catch (e) { next(e); }
});
