import { Router } from 'express';
import { authenticate, requireEventRole } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { ok, created, fail, notFound, conflict } from '../utils/response.js';
import {
  validateTemplate,
  buildVarMap,
  renderTemplate,
  resolveTimezone,
  formatTimezoneLabel,
} from '../services/templateRenderer.js';

export const remindersRouter = Router();

const MAX_REMINDERS = 5;
const MIN_LEAD_MS   = 5 * 60 * 1000; // 5 minutes

const VALID_RECURRENCE = new Set([
  'never', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly',
  'fortnightly', 'monthly', 'every_3_months', 'every_6_months', 'yearly',
]);

const RECURRENCE_TO_PRISMA = {
  never: 'NEVER', hourly: 'HOURLY', daily: 'DAILY',
  weekdays: 'WEEKDAYS', weekends: 'WEEKENDS', weekly: 'WEEKLY',
  fortnightly: 'FORTNIGHTLY', monthly: 'MONTHLY',
  every_3_months: 'EVERY_3_MONTHS', every_6_months: 'EVERY_6_MONTHS', yearly: 'YEARLY',
};

const VALID_CHANNELS = new Set(['email', 'sms']);

// Strip HTML tags to produce a plain-text version
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Validate both templates and return array of error strings
function checkTemplates(subjectTemplate, bodyTemplate) {
  const errors = [];
  const badSubj = validateTemplate(subjectTemplate);
  const badBody = validateTemplate(bodyTemplate);
  if (badSubj.length) errors.push(`Unknown variables in subject_template: ${badSubj.join(', ')}`);
  if (badBody.length) errors.push(`Unknown variables in body_template: ${badBody.join(', ')}`);
  return errors;
}

// Load reminder only if it belongs to the given event
async function loadReminder(eventId, reminderId) {
  const r = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!r || r.eventId !== eventId) return null;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/reminders  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.post('/:id/reminders', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const { remind_at, subject_template, body_template, channels, recurrence } = req.body || {};

    // Required fields
    if (!remind_at || !subject_template || !body_template || !channels) {
      return fail(res, 'INVALID_PAYLOAD', 'remind_at, subject_template, body_template, and channels are required.', 422);
    }

    // Channel validation
    if (!Array.isArray(channels) || channels.length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'channels must be a non-empty array.', 422);
    }
    const invalidCh = channels.filter(c => !VALID_CHANNELS.has(String(c).toLowerCase()));
    if (invalidCh.length) {
      return fail(res, 'INVALID_PAYLOAD', `Invalid channels: ${invalidCh.join(', ')}. Must be email or sms.`, 422);
    }

    // Recurrence validation
    const rec = recurrence ? String(recurrence).toLowerCase() : 'never';
    if (!VALID_RECURRENCE.has(rec)) {
      return fail(res, 'INVALID_PAYLOAD', `Invalid recurrence value: ${recurrence}.`, 422);
    }

    // Template validation
    const templateErrors = checkTemplates(subject_template, body_template);
    if (templateErrors.length) {
      return fail(res, 'INVALID_TEMPLATE', templateErrors.join('; '), 422);
    }

    // Load and validate event
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return notFound(res, 'Event not found.');

    if (event.status !== 'ACTIVE') {
      return conflict(res, 'EVENT_NOT_ACTIVE', 'Cannot add reminders to a cancelled or archived event.');
    }

    // remind_at validation
    const remindAtDate = new Date(remind_at);
    if (isNaN(remindAtDate.getTime())) {
      return fail(res, 'INVALID_PAYLOAD', 'remind_at must be a valid ISO 8601 datetime.', 422);
    }
    if (remindAtDate.getTime() < Date.now() + MIN_LEAD_MS) {
      return fail(res, 'INVALID_PAYLOAD', 'remind_at must be at least 5 minutes in the future.', 422);
    }
    if (remindAtDate >= event.eventDatetime) {
      return fail(res, 'INVALID_PAYLOAD', 'remind_at must be before event_datetime.', 422);
    }

    // 5-reminder limit (all reminders regardless of status)
    const reminderCount = await prisma.reminder.count({ where: { eventId } });
    if (reminderCount >= MAX_REMINDERS) {
      return conflict(res, 'REMINDER_LIMIT_REACHED', 'Maximum 5 reminders per event.');
    }

    const reminder = await prisma.reminder.create({
      data: {
        eventId,
        remindAt: remindAtDate,
        subjectTemplate: subject_template,
        bodyTemplate:    body_template,
        channels:        channels.map(c => String(c).toUpperCase()),
        recurrence:      RECURRENCE_TO_PRISMA[rec],
      },
    });
    return created(res, { reminder });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/reminders  — reader+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.get('/:id/reminders', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const reminders = await prisma.reminder.findMany({
      where: { eventId: req.params.id },
      orderBy: { remindAt: 'asc' },
    });
    return ok(res, { reminders });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/reminders/:rid  — reader+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.get('/:id/reminders/:rid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');
    return ok(res, { reminder });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /events/:id/reminders/:rid  — contributor+
// Blocked if status is RECURRING, SENT, or CANCELLED
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.patch('/:id/reminders/:rid', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');

    const NON_EDITABLE = ['RECURRING', 'SENT', 'CANCELLED'];
    if (NON_EDITABLE.includes(reminder.status)) {
      return conflict(res, 'REMINDER_NOT_EDITABLE', 'Reminders with status recurring, sent, or cancelled cannot be edited.');
    }

    const { remind_at, subject_template, body_template, channels, recurrence } = req.body || {};
    const data = {};

    if (remind_at !== undefined) {
      const d = new Date(remind_at);
      if (isNaN(d.getTime())) {
        return fail(res, 'INVALID_PAYLOAD', 'remind_at must be a valid ISO 8601 datetime.', 422);
      }
      if (d.getTime() < Date.now() + MIN_LEAD_MS) {
        return fail(res, 'INVALID_PAYLOAD', 'remind_at must be at least 5 minutes in the future.', 422);
      }
      const event = await prisma.event.findUnique({ where: { id: req.params.id }, select: { eventDatetime: true } });
      if (event && d >= event.eventDatetime) {
        return fail(res, 'INVALID_PAYLOAD', 'remind_at must be before event_datetime.', 422);
      }
      data.remindAt = d;
    }

    if (channels !== undefined) {
      if (!Array.isArray(channels) || channels.length === 0) {
        return fail(res, 'INVALID_PAYLOAD', 'channels must be a non-empty array.', 422);
      }
      const invalidCh = channels.filter(c => !VALID_CHANNELS.has(String(c).toLowerCase()));
      if (invalidCh.length) return fail(res, 'INVALID_PAYLOAD', `Invalid channels: ${invalidCh.join(', ')}.`, 422);
      data.channels = channels.map(c => String(c).toUpperCase());
    }

    if (recurrence !== undefined) {
      const rec = String(recurrence).toLowerCase();
      if (!VALID_RECURRENCE.has(rec)) {
        return fail(res, 'INVALID_PAYLOAD', `Invalid recurrence value: ${recurrence}.`, 422);
      }
      data.recurrence = RECURRENCE_TO_PRISMA[rec];
    }

    if (subject_template !== undefined) data.subjectTemplate = subject_template;
    if (body_template !== undefined)    data.bodyTemplate    = body_template;

    // Validate templates (check final combined templates)
    const subjToCheck = subject_template !== undefined ? subject_template : reminder.subjectTemplate;
    const bodyToCheck = body_template    !== undefined ? body_template    : reminder.bodyTemplate;
    if (subject_template !== undefined || body_template !== undefined) {
      const templateErrors = checkTemplates(subjToCheck, bodyToCheck);
      if (templateErrors.length) return fail(res, 'INVALID_TEMPLATE', templateErrors.join('; '), 422);
    }

    if (Object.keys(data).length === 0) {
      return fail(res, 'INVALID_PAYLOAD', 'No updatable fields provided.', 400);
    }

    const updated = await prisma.reminder.update({ where: { id: reminder.id }, data });
    return ok(res, { reminder: updated });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /events/:id/reminders/:rid  — owner only
// Hard-delete if no dispatch records; cancel otherwise
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.delete('/:id/reminders/:rid', authenticate, requireEventRole('OWNER'), async (req, res, next) => {
  try {
    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');

    const dispatchCount = await prisma.reminderDispatch.count({ where: { reminderId: reminder.id } });
    if (dispatchCount > 0) {
      const cancelled = await prisma.reminder.update({
        where: { id: reminder.id },
        data:  { status: 'CANCELLED' },
      });
      return ok(res, { cancelled: true, reminder: cancelled });
    }

    await prisma.reminder.delete({ where: { id: reminder.id } });
    return ok(res, { deleted: true });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /events/:id/reminders/:rid/preview  — contributor+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.post('/:id/reminders/:rid/preview', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR'), async (req, res, next) => {
  try {
    const { subscriber_id, occurrence_number } = req.body || {};
    const occNum = Math.max(1, Number(occurrence_number) || 1);

    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');

    // Load event with owner + email wrapper
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { owner: { include: { emailWrapper: true } } },
    });
    if (!event) return notFound(res, 'Event not found.');

    const owner = event.owner;

    // Resolve subscriber
    let subForRender = null;
    let previewMode  = 'sample';

    if (subscriber_id) {
      const found = await prisma.subscriber.findUnique({ where: { id: subscriber_id } });
      if (found && found.eventId === event.id) {
        subForRender = found;
        previewMode  = 'real_subscriber';
      }
    }

    if (!subForRender) {
      // First active subscriber
      const first = await prisma.subscriber.findFirst({
        where:   { eventId: event.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      if (first) { subForRender = first; previewMode = 'real_subscriber'; }
    }

    // Fall back to sample data
    if (!subForRender) {
      subForRender = { firstname: 'Sample', lastname: 'Subscriber', timezone: null };
      previewMode  = 'sample';
    }

    // Resolve timezone
    const { tz, fallback } = resolveTimezone(subForRender, owner);

    // Build variable map and render
    const varMap         = buildVarMap({ subscriber: subForRender, owner, event, reminderDatetime: reminder.remindAt, occurrenceNumber: occNum });
    const renderedSubject = renderTemplate(reminder.subjectTemplate, varMap);
    const renderedBody    = renderTemplate(reminder.bodyTemplate,    varMap);

    // Apply owner's email wrapper if active
    let renderedBodyHtml = renderedBody;
    let wrapperApplied   = false;
    const wrapper = owner.emailWrapper;
    if (wrapper && wrapper.isActive) {
      renderedBodyHtml = wrapper.wrapperHtml.replace('{{body}}', renderedBody);
      wrapperApplied   = true;
    }

    return ok(res, {
      preview: {
        preview_mode:         previewMode,
        subscriber_id:        previewMode === 'real_subscriber' ? subForRender.id : null,
        subscriber_name:      `${subForRender.firstname} ${subForRender.lastname}`,
        occurrence_number:    occNum,
        rendered_subject:     renderedSubject,
        rendered_body_html:   renderedBodyHtml,
        rendered_body_plain:  stripHtml(renderedBody),
        wrapper_applied:      wrapperApplied,
        timezone_resolved:    formatTimezoneLabel(tz, fallback),
        timezone_fallback_used: fallback,
      },
    });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/reminders/:rid/report  — reader+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.get('/:id/reminders/:rid/report', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');

    const page    = Math.max(1, Number(req.query.page)     || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 20));
    const skip    = (page - 1) * perPage;

    const [reports, total] = await Promise.all([
      prisma.reminderReport.findMany({
        where:   { reminderId: reminder.id },
        orderBy: { occurrenceNumber: 'asc' },
        take:    perPage,
        skip,
      }),
      prisma.reminderReport.count({ where: { reminderId: reminder.id } }),
    ]);

    return ok(res, { reports }, { page, per_page: perPage, total });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id/reminders/:rid/report/:occ  — reader+
// ─────────────────────────────────────────────────────────────────────────────
remindersRouter.get('/:id/reminders/:rid/report/:occ', authenticate, requireEventRole('OWNER', 'CONTRIBUTOR', 'READER'), async (req, res, next) => {
  try {
    const reminder = await loadReminder(req.params.id, req.params.rid);
    if (!reminder) return notFound(res, 'Reminder not found.');

    const occ = parseInt(req.params.occ, 10);
    if (!Number.isInteger(occ) || occ < 1) {
      return fail(res, 'INVALID_PAYLOAD', 'Occurrence number must be a positive integer.', 400);
    }

    const report = await prisma.reminderReport.findUnique({
      where: { reminderId_occurrenceNumber: { reminderId: reminder.id, occurrenceNumber: occ } },
    });
    if (!report) return notFound(res, 'Report not found for this occurrence.');

    return ok(res, { report });
  } catch (e) { next(e); }
});
