import React, { useState } from 'react';
import { useListReminders } from '../hooks/useReminders.js';
import { useListReports } from '../hooks/useReports.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES = {
  SCHEDULED:  'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-yellow-100 text-yellow-700',
  RECURRING:  'bg-violet-100 text-violet-700',
  SENT:       'bg-green-100 text-green-700',
  CANCELLED:  'bg-red-100 text-red-700',
  FAILED:     'bg-red-200 text-red-800',
};

function StatusBadge({ status }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      aria-label={`Reminder status: ${status}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ── FailureDetails ────────────────────────────────────────────────────────────

function FailureDetails({ details }) {
  const rows = Array.isArray(details) ? details : [];
  if (rows.length === 0 || typeof rows[0] !== 'object') {
    return (
      <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(details, null, 2)}
      </pre>
    );
  }
  const keys = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr>
            {keys.map(k => (
              <th
                key={k}
                className="border-b border-red-200 px-3 py-1 text-left font-medium text-red-700"
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="even:bg-red-50">
              {keys.map(k => (
                <td key={k} className="border-b border-red-100 px-3 py-1 text-gray-700">
                  {String(row[k] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── OccurrenceRow ─────────────────────────────────────────────────────────────

function OccurrenceRow({ report }) {
  const [expanded, setExpanded] = useState(false);
  const hasFailures = report.totalFailed > 0 && report.failureDetails != null;

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-3 text-sm font-medium text-gray-900">
          #{report.occurrenceNumber}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">{fmt(report.createdAt)}</td>
        <td className="px-4 py-3 text-sm text-gray-900">{report.totalDispatches}</td>
        <td className="px-4 py-3 text-sm font-medium text-green-700">{report.totalSent}</td>
        <td className="px-4 py-3 text-sm font-medium text-red-600">{report.totalFailed}</td>
        <td className="px-4 py-3 text-sm text-yellow-600">{report.totalSkipped}</td>
        <td className="px-4 py-3 text-sm">
          {report.reportSentToOwner ? (
            <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">
              Sent {fmt(report.reportSentAt)}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Not sent</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-right">
          {hasFailures && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} failure details for occurrence ${report.occurrenceNumber}`}
              className="text-indigo-600 hover:text-indigo-500 text-xs font-medium whitespace-nowrap"
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}
        </td>
      </tr>
      {expanded && hasFailures && (
        <tr>
          <td colSpan={8} className="px-4 pb-4">
            <div className="rounded-md bg-red-50 border border-red-100 p-3">
              <p className="text-xs font-semibold text-red-700 mb-2">Failure details</p>
              <FailureDetails details={report.failureDetails} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── ReminderReportsPanel ──────────────────────────────────────────────────────

function ReminderReportsPanel({ eventId, reminderId }) {
  const [page, setPage] = useState(1);
  const perPage = 20;
  const { data, isLoading, isError } = useListReports(eventId, reminderId, { page, perPage });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="ml-2 text-sm text-gray-400">Loading reports…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="py-4 text-sm text-red-600 text-center">
        Failed to load reports.
      </p>
    );
  }

  const reports    = data?.data?.reports ?? [];
  const meta       = data?.meta          ?? {};
  const total      = meta.total          ?? reports.length;
  const totalPages = Math.ceil(total / perPage);

  if (reports.length === 0) {
    return (
      <p
        className="py-6 text-sm text-gray-500 text-center"
        aria-label="No reports"
      >
        No reports yet. Reports are generated after each scheduled dispatch.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md ring-1 ring-gray-200">
        <table
          className="min-w-full divide-y divide-gray-200"
          aria-label="Occurrence reports"
        >
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Occ.</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Sent</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Failed</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Skipped</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Owner notified</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {reports.map(r => (
              <OccurrenceRow key={r.id} report={r} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3">
          <button
            type="button"
            onClick={() => setPage(p => p - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="text-sm text-indigo-600 hover:text-indigo-500 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="text-sm text-indigo-600 hover:text-indigo-500 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── ReminderItem ──────────────────────────────────────────────────────────────

function ReminderItem({ eventId, reminder }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`Toggle reports for ${reminder.subjectTemplate ?? 'reminder'}`}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">
            {reminder.subjectTemplate}
          </span>
          <StatusBadge status={reminder.status} />
          <span className="text-xs text-gray-400 shrink-0">
            {reminder.occurrenceCount} occurrence{reminder.occurrenceCount !== 1 ? 's' : ''}
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-3 bg-white">
          <ReminderReportsPanel eventId={eventId} reminderId={reminder.id} />
        </div>
      )}
    </div>
  );
}

// ── ReportsTab ────────────────────────────────────────────────────────────────

export default function ReportsTab({ eventId }) {
  const { data: reminders, isLoading, isError } = useListReminders(eventId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="ml-2 text-sm text-gray-500">Loading reminders…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="py-8 text-center text-sm text-red-600">
        Failed to load reminders. Please try again.
      </p>
    );
  }

  const list = reminders ?? [];

  if (list.length === 0) {
    return (
      <div className="py-12 text-center" aria-label="No reminders">
        <p className="text-sm text-gray-500">No reminders have been created for this event yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Add reminders first, then visit this tab after they have been dispatched.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Reports" className="space-y-3">
      <p className="text-xs text-gray-500">
        Select a reminder to view per-occurrence delivery counts and failure summaries.
      </p>
      {list.map(r => (
        <ReminderItem key={r.id} eventId={eventId} reminder={r} />
      ))}
    </section>
  );
}
