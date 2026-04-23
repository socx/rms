import React, { useState, useRef } from 'react';
import {
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDeleteReminder,
  usePreviewReminder,
} from '../hooks/useReminders.js';

// ── Constants ──────────────────────────────────────────────────────────────

const RECURRENCE_OPTIONS = [
  { value: 'NEVER',          label: 'Never (one-time)' },
  { value: 'HOURLY',         label: 'Hourly' },
  { value: 'DAILY',          label: 'Daily' },
  { value: 'WEEKDAYS',       label: 'Weekdays (Mon–Fri)' },
  { value: 'WEEKENDS',       label: 'Weekends (Sat–Sun)' },
  { value: 'WEEKLY',         label: 'Weekly' },
  { value: 'FORTNIGHTLY',    label: 'Fortnightly' },
  { value: 'MONTHLY',        label: 'Monthly' },
  { value: 'EVERY_3_MONTHS', label: 'Every 3 months' },
  { value: 'EVERY_6_MONTHS', label: 'Every 6 months' },
  { value: 'YEARLY',         label: 'Yearly' },
];

const RECURRENCE_BADGE_STYLES = {
  NEVER:          'bg-gray-100 text-gray-600',
  HOURLY:         'bg-blue-100 text-blue-700',
  DAILY:          'bg-sky-100 text-sky-700',
  WEEKDAYS:       'bg-cyan-100 text-cyan-700',
  WEEKENDS:       'bg-teal-100 text-teal-700',
  WEEKLY:         'bg-violet-100 text-violet-700',
  FORTNIGHTLY:    'bg-purple-100 text-purple-700',
  MONTHLY:        'bg-indigo-100 text-indigo-700',
  EVERY_3_MONTHS: 'bg-pink-100 text-pink-700',
  EVERY_6_MONTHS: 'bg-rose-100 text-rose-700',
  YEARLY:         'bg-orange-100 text-orange-700',
};

const STATUS_BADGE_STYLES = {
  SCHEDULED:  'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-yellow-100 text-yellow-700',
  RECURRING:  'bg-violet-100 text-violet-700',
  SENT:       'bg-green-100 text-green-700',
  CANCELLED:  'bg-red-100 text-red-700',
  FAILED:     'bg-red-200 text-red-800',
};

const TEMPLATE_VARIABLES = [
  { name: 'subscriber_firstname',  label: 'subscriber_firstname' },
  { name: 'subscriber_lastname',   label: 'subscriber_lastname' },
  { name: 'subscriber_fullname',   label: 'subscriber_fullname' },
  { name: 'event_subject',         label: 'event_subject' },
  { name: 'event_description',     label: 'event_description' },
  { name: 'event_datetime',        label: 'event_datetime' },
  { name: 'event_date',            label: 'event_date' },
  { name: 'event_time',            label: 'event_time' },
  { name: 'event_location',        label: 'event_location' },
  { name: 'event_timezone_label',  label: 'event_timezone_label' },
  { name: 'owner_firstname',       label: 'owner_firstname' },
  { name: 'owner_lastname',        label: 'owner_lastname' },
  { name: 'owner_fullname',        label: 'owner_fullname' },
  { name: 'reminder_datetime',     label: 'reminder_datetime' },
  { name: 'occurrence_number',     label: 'occurrence_number' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

// ── Variable Helper Component ──────────────────────────────────────────────

function VariableHelper({ fieldRef, value, onChange }) {
  const [open, setOpen] = useState(false);

  function insert(varName) {
    const token = `{{${varName}}}`;
    const el = fieldRef.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end   = el.selectionEnd   ?? value.length;
    const newValue = value.slice(0, start) + token + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Toggle template variable helper"
        className="text-xs text-indigo-600 hover:text-indigo-500 font-medium select-none"
      >
        {open ? '▲ Hide variables' : '▼ Insert variable'}
      </button>
      {open && (
        <div
          aria-label="Template variable helper"
          className="mt-2 flex flex-wrap gap-1"
        >
          {TEMPLATE_VARIABLES.map(v => (
            <button
              key={v.name}
              type="button"
              title={`Insert {{${v.name}}}`}
              onClick={() => insert(v.name)}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 cursor-pointer"
            >
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600';

function formatDatetime(iso, tz) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: tz || 'UTC',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value ?? '';
    const hr = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hr}:${get('minute')}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function RecurrenceBadge({ recurrence }) {
  const label = recurrence.replace(/_/g, ' ');
  const style = RECURRENCE_BADGE_STYLES[recurrence] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      aria-label={`Recurrence: ${recurrence}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {label.charAt(0) + label.slice(1).toLowerCase()}
    </span>
  );
}

function StatusBadge({ status }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      aria-label={`Reminder status: ${status}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ── Empty form state ────────────────────────────────────────────────────────

function emptyForm() {
  return {
    remind_at: '',
    subject_template: '',
    body_template: '',
    channels: [],
    recurrence: 'NEVER',
  };
}

function reminderToForm(r) {
  return {
    remind_at: toDatetimeLocal(r.remindAt),
    subject_template: r.subjectTemplate ?? '',
    body_template: r.bodyTemplate ?? '',
    channels: (r.channels ?? []).map(c => c.toLowerCase()),
    recurrence: r.recurrence ?? 'NEVER',
  };
}

// ── Reminder Form Modal ─────────────────────────────────────────────────────

function ReminderFormModal({ eventId, onClose, reminder = null }) {
  const isEdit = !!reminder;
  const create = useCreateReminder();
  const update = useUpdateReminder();
  const preview = usePreviewReminder();

  const [form, setForm] = useState(() => (isEdit ? reminderToForm(reminder) : emptyForm()));
  const [error, setError] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState(null);

  const subjectRef = useRef(null);
  const bodyRef    = useRef(null);

  const mutation = isEdit ? update : create;

  function setField(name, value) {
    setForm(f => ({ ...f, [name]: value }));
  }

  function toggleChannel(ch) {
    setForm(f => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter(c => c !== ch)
        : [...f.channels, ch],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.remind_at) { setError('Remind at date & time is required.'); return; }
    if (!form.subject_template.trim()) { setError('Subject template is required.'); return; }
    if (!form.body_template.trim()) { setError('Body template is required.'); return; }
    if (form.channels.length === 0) { setError('At least one channel must be selected.'); return; }

    const payload = {
      remind_at:        new Date(form.remind_at).toISOString(),
      subject_template: form.subject_template.trim(),
      body_template:    form.body_template.trim(),
      channels:         form.channels,
      recurrence:       form.recurrence,
    };

    try {
      if (isEdit) {
        await mutation.mutateAsync({ eventId, reminderId: reminder.id, ...payload });
      } else {
        await mutation.mutateAsync({ eventId, ...payload });
      }
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to save reminder.');
    }
  }

  async function handlePreview() {
    setPreviewError(null);
    setPreviewData(null);
    if (!reminder) return;
    try {
      const data = await preview.mutateAsync({ eventId, reminderId: reminder.id });
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err?.response?.data?.error?.message ?? err?.message ?? 'Preview failed.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit reminder' : 'Add reminder'}
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

      <div className="flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            {isEdit ? 'Edit reminder' : 'Add reminder'}
          </h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={isEdit ? 'Edit reminder form' : 'Add reminder form'}>
            {error && (
              <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="rm-remind-at" className="block text-sm font-medium text-gray-700 mb-1">
                Remind at <span aria-hidden className="text-red-500">*</span>
              </label>
              <input
                id="rm-remind-at"
                type="datetime-local"
                value={form.remind_at}
                onChange={e => setField('remind_at', e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="rm-subject" className="block text-sm font-medium text-gray-700 mb-1">
                Subject template <span aria-hidden className="text-red-500">*</span>
              </label>
              <input
                id="rm-subject"
                ref={subjectRef}
                type="text"
                value={form.subject_template}
                onChange={e => setField('subject_template', e.target.value)}
                placeholder="e.g. Reminder: {{event_subject}}"
                className={inputClass}
              />
              <VariableHelper
                fieldRef={subjectRef}
                value={form.subject_template}
                onChange={v => setField('subject_template', v)}
              />
            </div>

            <div>
              <label htmlFor="rm-body" className="block text-sm font-medium text-gray-700 mb-1">
                Body template <span aria-hidden className="text-red-500">*</span>
              </label>
              <textarea
                id="rm-body"
                ref={bodyRef}
                rows={5}
                value={form.body_template}
                onChange={e => setField('body_template', e.target.value)}
                placeholder="<p>Hi {{subscriber_firstname}}, …</p>"
                className={`${inputClass} resize-y`}
              />
              <VariableHelper
                fieldRef={bodyRef}
                value={form.body_template}
                onChange={v => setField('body_template', v)}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-gray-700 mb-1">
                Channels <span aria-hidden className="text-red-500">*</span>
              </legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.channels.includes('email')}
                    onChange={() => toggleChannel('email')}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.channels.includes('sms')}
                    onChange={() => toggleChannel('sms')}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  SMS
                </label>
              </div>
            </fieldset>

            <div>
              <label htmlFor="rm-recurrence" className="block text-sm font-medium text-gray-700 mb-1">
                Recurrence
              </label>
              <select
                id="rm-recurrence"
                value={form.recurrence}
                onChange={e => setField('recurrence', e.target.value)}
                className={inputClass}
              >
                {RECURRENCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between pt-2">
              {isEdit && (
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={preview.isPending}
                  className="text-sm text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
                >
                  {preview.isPending ? 'Loading preview…' : 'Preview occurrence'}
                </button>
              )}
              {!isEdit && <span />}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
                >
                  {mutation.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Add reminder')}
                </button>
              </div>
            </div>
          </form>

          {/* Occurrence preview panel */}
          {previewError && (
            <div role="alert" className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
              {previewError}
            </div>
          )}
          {previewData && (
            <div
              aria-label="Occurrence preview"
              className="mt-4 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-800 ring-1 ring-gray-200 space-y-2"
            >
              <p className="font-semibold text-gray-700">Occurrence preview</p>
              {previewData.renderedSubject != null && (
                <p><span className="font-medium">Subject:</span> {previewData.renderedSubject}</p>
              )}
              {previewData.renderedBody != null && (
                <div>
                  <span className="font-medium block mb-1">Body:</span>
                  <div
                    className="prose prose-sm max-w-none text-gray-700"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: previewData.renderedBody }}
                  />
                </div>
              )}
              {previewData.nextRemindAt && (
                <p className="text-xs text-gray-500">
                  Next occurrence: {formatDatetime(previewData.nextRemindAt, 'UTC')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reminder Row ────────────────────────────────────────────────────────────

function ReminderRow({ reminder, eventId, canEdit, canDelete, eventTimezone }) {
  const [showEdit, setShowEdit] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const deleteReminder = useDeleteReminder();
  const [deleteError, setDeleteError] = useState(null);

  const isEditable = canEdit && !['RECURRING', 'SENT', 'CANCELLED', 'FAILED'].includes(reminder.status);

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteReminder.mutateAsync({ eventId, reminderId: reminder.id });
      setShowConfirm(false);
    } catch (err) {
      setDeleteError(err?.response?.data?.error?.message ?? err?.message ?? 'Delete failed.');
    }
  }

  return (
    <>
      <li className="rounded-lg border border-gray-200 px-4 py-3 space-y-2" aria-label={`Reminder: ${reminder.subjectTemplate}`}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{reminder.subjectTemplate}</span>
            <StatusBadge status={reminder.status} />
            {reminder.recurrence !== 'NEVER' && <RecurrenceBadge recurrence={reminder.recurrence} />}
          </div>
          <div className="flex items-center gap-2">
            {isEditable && (
              <button
                type="button"
                onClick={() => setShowEdit(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                aria-label={`Cancel reminder ${reminder.subjectTemplate}`}
                className="text-xs font-medium text-red-600 hover:text-red-500"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 space-y-0.5">
          <p>
            <span className="font-medium">Remind at:</span>{' '}
            {formatDatetime(reminder.remindAt, eventTimezone)}
          </p>
          <p>
            <span className="font-medium">Channels:</span>{' '}
            {(reminder.channels ?? []).join(', ')}
          </p>
          {reminder.occurrenceCount > 0 && (
            <p>
              <span className="font-medium">Occurrences sent:</span>{' '}
              {reminder.occurrenceCount}
            </p>
          )}
        </div>

        {deleteError && (
          <p role="alert" className="text-xs text-red-600">{deleteError}</p>
        )}
      </li>

      {showEdit && (
        <ReminderFormModal
          eventId={eventId}
          reminder={reminder}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm cancel reminder"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowConfirm(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Cancel this reminder?</h3>
            <p className="text-sm text-gray-600">
              This will cancel the reminder. If it has already dispatched, it cannot be un-cancelled.
            </p>
            {deleteError && (
              <p role="alert" className="text-sm text-red-600">{deleteError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteReminder.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60"
              >
                {deleteReminder.isPending ? 'Cancelling…' : 'Cancel reminder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Reminders Tab ──────────────────────────────────────────────────────────

/**
 * Props:
 *  eventId      – string
 *  isOwner      – boolean
 *  canWrite     – boolean (OWNER or CONTRIBUTOR + event ACTIVE)
 *  eventTimezone – string
 */
export default function RemindersTab({ eventId, isOwner, canWrite, eventTimezone }) {
  const { data: reminders = [], isLoading, isError, error } = useListReminders(eventId);
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) {
    return <p className="text-sm text-gray-500 py-4">Loading reminders…</p>;
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
        {error?.response?.data?.error?.message ?? error?.message ?? 'Failed to load reminders.'}
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Reminders">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Reminders{reminders.length > 0 ? ` (${reminders.length})` : ''}
        </h2>
        {canWrite && reminders.length < 5 && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            + Add reminder
          </button>
        )}
      </div>

      {/* List */}
      {reminders.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">No reminders yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Reminders list">
          {reminders.map(r => (
            <ReminderRow
              key={r.id}
              reminder={r}
              eventId={eventId}
              canEdit={canWrite}
              canDelete={isOwner}
              eventTimezone={eventTimezone}
            />
          ))}
        </ul>
      )}

      {/* Add modal */}
      {showAdd && (
        <ReminderFormModal
          eventId={eventId}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
