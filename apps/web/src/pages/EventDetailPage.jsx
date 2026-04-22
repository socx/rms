import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getStoredUserId } from '../hooks/useAuth.js';
import { useGetEvent, useUpdateEvent } from '../hooks/useEvents.js';
import RemindersTab from './RemindersTab.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDatetime(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Convert an ISO datetime string to a YYYY-MM-DDTHH:MM value for a
 * datetime-local input, expressed in the given timezone.
 */
function toDatetimeLocal(iso, tz) {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
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

// ── Badges ────────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  ACTIVE:    'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-700',
  ARCHIVED:  'bg-gray-100 text-gray-600',
};

function StatusBadge({ status }) {
  return (
    <span
      aria-label={`Status: ${status}`}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ── Read-only field ───────────────────────────────────────────────────────────

function ReadField({ label, children, value }) {
  const content = children ?? (value != null && value !== '' ? value : <span className="text-gray-400 italic">—</span>);
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{content}</dd>
    </div>
  );
}

// ── Input class ───────────────────────────────────────────────────────────────

const inputClass =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600';

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EventDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const { data: event, isLoading, isError, error } = useGetEvent(id);
  const update = useUpdateEvent();

  // Form state (owner edit)
  const [subject,     setSubject]   = useState('');
  const [datetime,    setDatetime]  = useState('');
  const [timezone,    setTimezone]  = useState('');
  const [location,    setLocation]  = useState('');
  const [description, setDesc]      = useState('');
  const [formError,   setFormError] = useState(null);
  const [saveOk,      setSaveOk]    = useState(false);
  const [activeTab,   setActiveTab] = useState('details');

  // Populate form once event is loaded
  useEffect(() => {
    if (event) {
      setSubject(event.subject ?? '');
      setDatetime(event.eventDatetime ? toDatetimeLocal(event.eventDatetime, event.eventTimezone) : '');
      setTimezone(event.eventTimezone ?? 'UTC');
      setLocation(event.location ?? '');
      setDesc(event.description ?? '');
    }
  }, [event]);

  if (!userId) return null;

  // ── Loading / error ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
          <Link to="/events" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            ← Back to events
          </Link>
          <div role="alert" className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error?.response?.data?.error?.message ?? error?.message ?? 'Failed to load event.'}
          </div>
        </div>
      </div>
    );
  }

  if (!event) return null;

  const isOwner   = event.ownerId === userId;
  const canEdit   = isOwner && event.status === 'ACTIVE';
  // OWNER and CONTRIBUTOR can create/edit reminders; READER and unauthenticated visitors cannot
  const eventRole = isOwner ? 'OWNER' : (event.myRole ?? null); // API may supply myRole for non-owners
  const canWrite  = event.status === 'ACTIVE' && (isOwner || eventRole === 'CONTRIBUTOR');
  const roleLabel = isOwner ? 'Owner' : 'Shared';

  // ── Save handler ──────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault();
    setFormError(null);
    setSaveOk(false);
    if (!subject.trim()) { setFormError('Subject is required.'); return; }
    if (!datetime)       { setFormError('Date & time is required.'); return; }
    try {
      await update.mutateAsync({
        id,
        subject:       subject.trim(),
        eventDatetime: new Date(datetime).toISOString(),
        eventTimezone: timezone || 'UTC',
        location:      location.trim() || undefined,
        description:   description.trim() || undefined,
      });
      setSaveOk(true);
    } catch (err) {
      setFormError(
        err?.response?.data?.error?.message ?? err?.message ?? 'Failed to save event.'
      );
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-2xl">

        {/* Header bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
              <span className="text-sm font-bold text-white select-none">RMS</span>
            </div>
            <Link
              to="/events"
              aria-label="Back to events"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              ← Back to events
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={event.status} />
            <span
              aria-label={`Role: ${roleLabel}`}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${isOwner ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}
            >
              {roleLabel}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-white shadow">
          {/* Tab bar */}
          <div className="border-b border-gray-200 px-6 pt-6">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 mb-4">
              Event details
            </h1>
            <nav className="-mb-px flex gap-6" aria-label="Event tabs">
              {[
                { key: 'details',   label: 'Details' },
                { key: 'reminders', label: 'Reminders' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* ── Details tab ──────────────────────────────────────────── */}
            <div hidden={activeTab !== 'details'}>
          {saveOk && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200"
            >
              Event updated successfully.
            </div>
          )}

          {canEdit ? (
            /* ── Editable form — OWNER + ACTIVE ─────────────────────── */
            <form onSubmit={handleSave} noValidate className="space-y-4" aria-label="Edit event">
              {formError && (
                <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="ed-subject" className="block text-sm font-medium text-gray-700 mb-1">
                  Subject <span aria-hidden className="text-red-500">*</span>
                </label>
                <input
                  id="ed-subject"
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="ed-datetime" className="block text-sm font-medium text-gray-700 mb-1">
                  Date &amp; time <span aria-hidden className="text-red-500">*</span>
                </label>
                <input
                  id="ed-datetime"
                  type="datetime-local"
                  value={datetime}
                  onChange={e => setDatetime(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="ed-timezone" className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone
                </label>
                <input
                  id="ed-timezone"
                  type="text"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  placeholder="e.g. Europe/London"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="ed-location" className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  id="ed-location"
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. Conference Room B"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="ed-description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  id="ed-description"
                  rows={4}
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="Optional details…"
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={update.isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
                >
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          ) : (
            /* ── Read-only view — CONTRIBUTOR, READER, or non-ACTIVE ── */
            <dl className="space-y-5" aria-label="Event details">
              <ReadField label="Subject" value={event.subject} />
              <ReadField label="Date & Time">
                {formatDatetime(event.eventDatetime, event.eventTimezone)}
                <span className="ml-2 text-xs text-gray-400">{event.eventTimezone}</span>
              </ReadField>
              <ReadField label="Timezone" value={event.eventTimezone} />
              <ReadField label="Location" value={event.location} />
              <ReadField label="Description" value={event.description} />
            </dl>
          )}
            </div>{/* end details tab */}

            {/* ── Reminders tab ──────────────────────────────────────── */}
            <div hidden={activeTab !== 'reminders'}>
              <RemindersTab
                eventId={id}
                isOwner={isOwner}
                canWrite={canWrite}
                eventTimezone={event.eventTimezone ?? 'UTC'}
              />
            </div>
          </div>{/* end p-6 */}
        </div>
      </div>
    </div>
  );
}
