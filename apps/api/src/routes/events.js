import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
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
		const q = (req.query.q || '').trim();
		const limit = Math.min(100, Number(req.query.limit) || 50);
		const offset = Number(req.query.offset) || 0;

		const where = {};
		if (q) where.OR = [
			{ subject: { contains: q, mode: 'insensitive' } },
			{ description: { contains: q, mode: 'insensitive' } },
		];

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
eventsRouter.get('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		// If event not active, non-admins should see 404
		if (String(event.status).toLowerCase() !== 'active' && String(req.user.systemRole).toLowerCase() !== 'system_admin')
			return notFound(res, 'Event not found.');

		// Check access: owner, access record, or system_admin
		if (String(req.user.systemRole).toLowerCase() !== 'system_admin') {
			if (event.ownerId !== req.user.id) {
				const access = await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: id, userId: req.user.id } } });
				if (!access) return forbidden(res, 'Insufficient event access.');
			}
		}

		const ev = await prisma.event.findUnique({ where: { id }, include: { reminders: true, subscribers: true } });
		return ok(res, { event: ev });
	} catch (e) { next(e); }
});

// PATCH /events/:id - update event (owner or system_admin)
eventsRouter.patch('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		const { subject, description, eventDatetime, eventTimezone, location, status } = req.body || {};
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		if (String(req.user.systemRole).toLowerCase() !== 'system_admin' && event.ownerId !== req.user.id)
			return forbidden(res, 'Only event owner or system_admin may modify the event.');

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
eventsRouter.delete('/:id', authenticate, async (req, res, next) => {
	try {
		const { id } = req.params;
		const event = await prisma.event.findUnique({ where: { id } });
		if (!event) return notFound(res, 'Event not found.');

		if (String(req.user.systemRole).toLowerCase() !== 'system_admin' && event.ownerId !== req.user.id)
			return forbidden(res, 'Only event owner or system_admin may delete the event.');

		const archived = await prisma.event.update({ where: { id }, data: { status: 'ARCHIVED' }, select: { id: true, status: true } });
		return ok(res, { event: archived });
	} catch (e) { next(e); }
});
