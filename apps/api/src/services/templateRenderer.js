import { DateTime } from 'luxon';

const ALLOWED_VARS = new Set([
  'subscriber_firstname','subscriber_lastname','subscriber_fullname',
  'event_subject','event_description','event_datetime','event_date','event_time',
  'event_location','event_timezone_label',
  'owner_firstname','owner_lastname','owner_fullname',
  'reminder_datetime','occurrence_number',
]);

export function validateTemplate(template) {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter(v => !ALLOWED_VARS.has(v));
}

export function resolveTimezone(subscriber, owner) {
  if (subscriber.timezone) return { tz: subscriber.timezone, fallback: false };
  if (owner.timezone)      return { tz: owner.timezone,      fallback: true  };
  return { tz: 'UTC', fallback: true };
}

export function formatTimezoneLabel(tz, fallback) {
  try {
    const abbr = DateTime.now().setZone(tz).toFormat('ZZZZ');
    const label = `${tz} (${abbr})`;
    return fallback ? `${label} — using event owner's timezone` : label;
  } catch { return tz; }
}

export function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export function buildVarMap({ subscriber, owner, event, reminderDatetime, occurrenceNumber }) {
  const { tz, fallback } = resolveTimezone(subscriber, owner);
  const eventDt = DateTime.fromJSDate(event.eventDatetime).setZone(tz);
  const remDt   = DateTime.fromJSDate(reminderDatetime).setZone(tz);
  return {
    subscriber_firstname:  subscriber.firstname,
    subscriber_lastname:   subscriber.lastname,
    subscriber_fullname:   `${subscriber.firstname} ${subscriber.lastname}`,
    event_subject:         event.subject,
    event_description:     event.description ?? '',
    event_datetime:        eventDt.toLocaleString(DateTime.DATETIME_MED),
    event_date:            eventDt.toLocaleString(DateTime.DATE_MED),
    event_time:            eventDt.toLocaleString(DateTime.TIME_SIMPLE),
    event_location:        event.location ?? 'TBD',
    event_timezone_label:  formatTimezoneLabel(tz, fallback),
    owner_firstname:       owner.firstname,
    owner_lastname:        owner.lastname,
    owner_fullname:        `${owner.firstname} ${owner.lastname}`,
    reminder_datetime:     remDt.toLocaleString(DateTime.DATETIME_MED),
    occurrence_number:     String(occurrenceNumber),
  };
}
