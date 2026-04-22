import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStoredUserId } from '../hooks/useAuth.js';
import { useListEvents, useCreateEvent, useCancelEvent } from '../hooks/useEvents.js';

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

function RoleBadge({ isOwner }) {
  return isOwner ? (
    <span
      aria-label="Role: Owner"
      className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
    >
      Owner
    </span>
  ) : (
    <span
      aria-label="Role: Shared"
      className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
    >
      Shared
    </span>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── Create event modal ────────────────────────────────────────────────────────

function CreateEventModal({ onClose, onCreate }) {
  const [subject, setSubject]       = useState('');
  const [datetime, setDatetime]     = useState('');
  const [timezone, setTimezone]     = useState(() =>
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [location, setLocation]     = useState('');
  const [description, setDesc]      = useState('');
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const firstRef                    = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!datetime)        { setError('Date & time is required.'); return; }

    setSaving(true);
    try {
      await onCreate({
        subject: subject.trim(),
        eventDatetime: new Date(datetime).toISOString(),
        eventTimezone: timezone,
        location:      location.trim() || undefined,
        description:   description.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(
        err?.response?.data?.error?.message ?? err?.message ?? 'Failed to create event.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-event-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="create-event-heading" className="text-base font-semibold text-gray-900 mb-4">
          Create event
        </h2>

        {error && (
          <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="ev-subject" className="block text-sm font-medium text-gray-700 mb-1">
              Subject <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              ref={firstRef}
              id="ev-subject"
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Annual team meeting"
              className="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
            />
          </div>

          <div>
            <label htmlFor="ev-datetime" className="block text-sm font-medium text-gray-700 mb-1">
              Date &amp; time <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="ev-datetime"
              type="datetime-local"
              value={datetime}
              onChange={e => setDatetime(e.target.value)}
              className="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
            />
          </div>

          <div>
            <label htmlFor="ev-timezone" className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <input
              id="ev-timezone"
              type="text"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              placeholder="e.g. Europe/Berlin"
              className="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
            />
          </div>

          <div>
            <label htmlFor="ev-location" className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <input
              id="ev-location"
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Conference Room B"
              className="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
            />
          </div>

          <div>
            <label htmlFor="ev-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="ev-description"
              rows={3}
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional details…"
              className="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              aria-label="Create event"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Cancel confirm modal ──────────────────────────────────────────────────────

function CancelModal({ event, onConfirm, onClose, isPending }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-event-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 id="cancel-event-heading" className="text-base font-semibold text-gray-900">
          Cancel event?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          <strong>{event.subject}</strong> will be marked as cancelled and all scheduled
          reminders will be cancelled. This cannot be undone.
        </p>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Keep event
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
          >
            {isPending ? 'Cancelling…' : 'Cancel event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Role / Status filter state types ─────────────────────────────────────────

const ROLE_FILTERS  = ['All', 'Owner', 'Shared'];
const STATUS_FILTERS = ['All', 'Active', 'Cancelled', 'Archived'];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const [search, setSearch]           = useState('');
  const [debouncedQ, setDebouncedQ]   = useState('');
  const [roleFilter, setRoleFilter]   = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showCreate, setShowCreate]   = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [createOk, setCreateOk]       = useState(false);
  const [cancelOk, setCancelOk]       = useState(false);
  const debounceRef                   = useRef(null);

  // Debounce search input
  function handleSearchChange(e) {
    const v = e.target.value;
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 350);
  }

  const events = useListEvents({ q: debouncedQ });
  const create = useCreateEvent();
  const cancel = useCancelEvent();

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = (events.data ?? []).filter(ev => {
    const isOwner = ev.ownerId === userId;

    if (roleFilter === 'Owner'  && !isOwner)  return false;
    if (roleFilter === 'Shared' && isOwner)   return false;

    if (statusFilter !== 'All') {
      if (ev.status !== statusFilter.toUpperCase()) return false;
    }

    return true;
  });

  // Whether any non-ACTIVE statuses appear in the data (admin sees all)
  const hasNonActive = (events.data ?? []).some(ev => ev.status !== 'ACTIVE');

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function handleCreate(data) {
    await create.mutateAsync(data);
    setCreateOk(true);
  }

  async function handleCancelConfirm() {
    await cancel.mutateAsync(cancelTarget.id);
    setCancelTarget(null);
    setCancelOk(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
      {showCreate && (
        <CreateEventModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
      {cancelTarget && (
        <CancelModal
          event={cancelTarget}
          onConfirm={handleCancelConfirm}
          onClose={() => setCancelTarget(null)}
          isPending={cancel.isPending}
        />
      )}

      <div className="sm:mx-auto sm:w-full sm:max-w-5xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
              <span className="text-sm font-bold text-white select-none">RMS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">My Events</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/profile"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Edit profile
            </Link>
            <button
              type="button"
              onClick={() => { setShowCreate(true); setCreateOk(false); }}
              aria-label="Create event"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              + Create event
            </button>
          </div>
        </div>

        {/* Success banners */}
        {createOk && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200"
          >
            Event created successfully.
          </div>
        )}
        {cancelOk && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800 ring-1 ring-blue-200"
          >
            Event cancelled.
          </div>
        )}

        {/* Filters toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <svg
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
            </svg>
            <input
              type="search"
              aria-label="Search events"
              value={search}
              onChange={handleSearchChange}
              placeholder="Search events…"
              className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 bg-white"
            />
          </div>

          {/* Role filter */}
          <div className="flex items-center gap-1.5" aria-label="Filter by role">
            {ROLE_FILTERS.map(f => (
              <FilterPill key={f} active={roleFilter === f} onClick={() => setRoleFilter(f)}>
                {f}
              </FilterPill>
            ))}
          </div>

          {/* Status filter — only shown when non-active statuses are present (e.g. admin) */}
          {hasNonActive && (
            <div className="flex items-center gap-1.5" aria-label="Filter by status">
              {STATUS_FILTERS.map(f => (
                <FilterPill key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
                  {f}
                </FilterPill>
              ))}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg bg-white shadow">
          {events.isLoading && (
            <div className="px-6 py-12 text-center text-sm text-gray-500">Loading…</div>
          )}

          {events.isError && (
            <div role="alert" className="px-6 py-8 text-center text-sm text-red-600">
              Failed to load events. {events.error?.response?.data?.error?.message ?? events.error?.message}
            </div>
          )}

          {!events.isLoading && !events.isError && filtered.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">
                {(events.data?.length ?? 0) === 0
                  ? 'No events yet. Create your first event above.'
                  : 'No events match the current filters.'}
              </p>
              {(events.data?.length ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  + Create event
                </button>
              )}
            </div>
          )}

          {!events.isLoading && filtered.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200" aria-label="Events list">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="py-3 pl-6 pr-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Subject
                  </th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Date &amp; Time
                  </th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(ev => {
                  const isOwner = ev.ownerId === userId;
                  return (
                    <tr key={ev.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-4 pl-6 pr-3">
                        <Link
                          to={`/events/${ev.id}`}
                          className="text-sm font-medium text-gray-900 hover:text-indigo-600"
                        >
                          {ev.subject}
                        </Link>
                        {ev.location && (
                          <p className="text-xs text-gray-500 mt-0.5">{ev.location}</p>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <span className="text-sm text-gray-700 whitespace-nowrap">
                          {formatDatetime(ev.eventDatetime, ev.eventTimezone)}
                        </span>
                        <p className="text-xs text-gray-400 mt-0.5">{ev.eventTimezone}</p>
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge status={ev.status} />
                      </td>
                      <td className="px-3 py-4">
                        <RoleBadge isOwner={isOwner} />
                      </td>
                      <td className="px-3 py-4 text-right">
                        {isOwner && ev.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => { setCancelTarget(ev); setCancelOk(false); }}
                            aria-label={`Cancel ${ev.subject}`}
                            className="text-xs font-medium text-red-600 hover:text-red-500"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Results count */}
        {!events.isLoading && filtered.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            {roleFilter !== 'All' || statusFilter !== 'All' ? ' (filtered)' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
