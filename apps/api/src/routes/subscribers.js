import { Router } from 'express';
import { authenticate, requireEventRole } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, created, fail, notFound, conflict } from '../utils/response.js';
import { writeAudit, getIp } from '../utils/audit.js';

export const subscribersRouter = Router();

// Helper: verify event exists and subscriber belongs to it
async function loadSubscriber(eventId, subscriberId) {
  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    include: { contacts: { orderBy: { createdAt: 'asc' } } },
  });
  if (!sub || sub.eventId !== eventId) return null;
  return sub;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/subscribers  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.post('/:id/subscribers', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const { firstname, lastname, timezone, user_id, contacts } = req.body || {};

    if (!firstname || !lastname) {
      return fail(res, 'INVALID_PAYLOAD', 'firstname and lastname are required.', 422);
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'At least one contact is required.', 422);
    }

    // Validate each contact
    for (const c of contacts) {
      if (!c.channel || !c.contact_value) {
        return fail(res, 'INVALID_PAYLOAD', 'Each contact must have channel and contact_value.', 422);
      }
      if (!['email', 'sms'].includes(String(c.channel).toLowerCase())) {
        return fail(res, 'INVALID_PAYLOAD', `Invalid channel: ${c.channel}. Must be email or sms.`, 422);
      }
    }

    // Verify event exists
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) return notFound(res, 'Event not found.');

    const subscriber = await prisma.subscriber.create({
      data: {
        eventId,
        userId: user_id || null,
        firstname,
        lastname,
        timezone: timezone || null,
        contacts: {
          create: contacts.map(c => ({
            channel: String(c.channel).toUpperCase(),
            contactValue: c.contact_value,
            isPrimary: c.is_primary === true,
            label: c.label || null,
          })),
        },
      },
      include: { contacts: { orderBy: { createdAt: 'asc' } } },
    });

    writeAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'CREATE', entityType: 'SUBSCRIBER', entityId: subscriber.id, entitySummary: `${subscriber.firstname} ${subscriber.lastname}`, ipAddress: getIp(req) });
    return created(res, { subscriber });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/subscribers  — reader+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.get('/:id/subscribers', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 20));
    const skip = (page - 1) * perPage;

    const where = { eventId };
    if (req.query.status) where.status = String(req.query.status).toUpperCase();

    const [subscribers, total] = await Promise.all([
      prisma.subscriber.findMany({
        where,
        include: { contacts: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
        take: perPage,
        skip,
      }),
      prisma.subscriber.count({ where }),
    ]);

    return ok(res, { subscribers }, { page, per_page: perPage, total });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/subscribers/:sid  — reader+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.get('/:id/subscribers/:sid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');
    return ok(res, { subscriber: sub });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /events/:id/subscribers/:sid  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.patch('/:id/subscribers/:sid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    const { firstname, lastname, timezone } = req.body || {};
    const data = {};
    if (typeof firstname === 'string') data.firstname = firstname;
    if (typeof lastname === 'string') data.lastname = lastname;
    if ('timezone' in req.body) data.timezone = req.body.timezone || null;

    if (Object.keys(data).length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'No updatable fields provided.', 400);
    }

    const updated = await prisma.subscriber.update({
      where: { id: sub.id },
      data,
      include: { contacts: { orderBy: { createdAt: 'asc' } } },
    });
    writeAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'UPDATE', entityType: 'SUBSCRIBER', entityId: sub.id, entitySummary: `${sub.firstname} ${sub.lastname}`, changes: data, ipAddress: getIp(req) });
    return ok(res, { subscriber: updated });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /events/:id/subscribers/:sid  — contributor+
// Last-subscriber guard: cannot remove the only active subscriber
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.delete('/:id/subscribers/:sid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const { id: eventId, sid } = req.params;
    const sub = await loadSubscriber(eventId, sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    // Last-subscriber guard
    const activeCount = await prisma.subscriber.count({
      where: { eventId, status: 'ACTIVE' },
    });
    if (activeCount <= 1 && sub.status === 'ACTIVE') {
      return conflict(res, 'LAST_SUBSCRIBER', 'An event must have at least one active subscriber.');
    }

    await prisma.subscriber.delete({ where: { id: sid } });
    writeAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'DELETE', entityType: 'SUBSCRIBER', entityId: sid, entitySummary: `${sub.firstname} ${sub.lastname}`, ipAddress: getIp(req) });
    return ok(res, { deleted: true });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/subscribers/:sid/unsubscribe  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.post('/:id/subscribers/:sid/unsubscribe', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    const updated = await prisma.subscriber.update({
      where: { id: sub.id },
      data: { status: 'UNSUBSCRIBED' },
      include: { contacts: { orderBy: { createdAt: 'asc' } } },
    });
    return ok(res, { subscriber: updated });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/subscribers/:sid/contacts  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.post('/:id/subscribers/:sid/contacts', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    const { channel, contact_value, is_primary, label } = req.body || {};
    if (!channel || !contact_value) {
      return fail(res, 'INVALID_PAYLOAD', 'channel and contact_value are required.', 422);
    }
    if (!['email', 'sms'].includes(String(channel).toLowerCase())) {
      return fail(res, 'INVALID_PAYLOAD', `Invalid channel: ${channel}. Must be email or sms.`, 422);
    }

    const contact = await prisma.subscriberContact.create({
      data: {
        subscriberId: sub.id,
        channel: String(channel).toUpperCase(),
        contactValue: contact_value,
        isPrimary: is_primary === true,
        label: label || null,
      },
    });
    return created(res, { contact });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /events/:id/subscribers/:sid/contacts/:cid  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.patch('/:id/subscribers/:sid/contacts/:cid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    const contact = sub.contacts.find(c => c.id === req.params.cid);
    if (!contact) return notFound(res, 'Contact not found.');

    const { contact_value, is_primary, label, status } = req.body || {};
    const data = {};
    if (typeof contact_value === 'string') data.contactValue = contact_value;
    if (typeof is_primary === 'boolean') data.isPrimary = is_primary;
    if ('label' in req.body) data.label = req.body.label || null;
    if (typeof status === 'string') {
      const s = status.toUpperCase();
      if (!['ACTIVE', 'INACTIVE'].includes(s)) {
        return fail(res, 'INVALID_PAYLOAD', 'status must be active or inactive.', 422);
      }
      data.status = s;
    }

    if (Object.keys(data).length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'No updatable fields provided.', 400);
    }

    const updated = await prisma.subscriberContact.update({
      where: { id: contact.id },
      data,
    });
    return ok(res, { contact: updated });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /events/:id/subscribers/:sid/contacts/:cid  — contributor+
// Last-contact guard: cannot remove the only active contact
// ─────────────────────────────────────────────────────────────────────────────
subscribersRouter.delete('/:id/subscribers/:sid/contacts/:cid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const sub = await loadSubscriber(req.params.id, req.params.sid);
    if (!sub) return notFound(res, 'Subscriber not found.');

    const contact = sub.contacts.find(c => c.id === req.params.cid);
    if (!contact) return notFound(res, 'Contact not found.');

    // Last-contact guard
    const activeContactCount = await prisma.subscriberContact.count({
      where: { subscriberId: sub.id, status: 'ACTIVE' },
    });
    if (activeContactCount <= 1 && contact.status === 'ACTIVE') {
      return conflict(res, 'LAST_CONTACT', 'A subscriber must have at least one active contact.');
    }

    await prisma.subscriberContact.delete({ where: { id: contact.id } });
    return ok(res, { deleted: true });
  } catch (e) { next(e); }
});

