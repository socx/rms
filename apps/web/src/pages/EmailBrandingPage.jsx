import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStoredUserId } from '../hooks/useAuth.js';
import {
  useGetEmailBranding,
  useUpsertEmailBranding,
  useDeleteEmailBranding,
  usePatchEmailBranding,
} from '../hooks/useEmailBranding.js';

// ── Sample email content injected into the live preview ──────────────────────

const SAMPLE_CONTENT = `
  <h2 style="margin:0 0 12px;font-size:20px;color:#111827">Reminder: Annual Team Meeting</h2>
  <p style="margin:0 0 8px;color:#374151">Hi Alice,</p>
  <p style="margin:0 0 8px;color:#374151">
    This is a reminder that <strong>Annual Team Meeting</strong> is coming up.
  </p>
  <table style="width:100%;border-collapse:collapse;margin:12px 0">
    <tr>
      <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap">Date</td>
      <td style="padding:6px 0;color:#111827;font-size:14px">Monday, 5 May 2026 at 9:00 AM</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap">Location</td>
      <td style="padding:6px 0;color:#111827;font-size:14px">Conference Room B</td>
    </tr>
  </table>
  <p style="margin:8px 0 0;color:#374151;font-size:13px">
    You are receiving this because you subscribed to reminders for this event.
  </p>
`;

const DEFAULT_WRAPPER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email</title>
  <style>
    body { margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .header { background: #4f46e5; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 22px; color: #ffffff; letter-spacing: -0.3px; }
    .body { padding: 28px 32px; }
    .footer { padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>RMS Reminder</h1></div>
    <div class="body">
      {{body}}
    </div>
    <div class="footer">You are receiving this because you subscribed to reminders on RMS.</div>
  </div>
</body>
</html>`;

// ── Live preview iframe ───────────────────────────────────────────────────────

function LivePreview({ html }) {
  const src = html.replace('{{body}}', SAMPLE_CONTENT);
  return (
    <iframe
      title="Email preview"
      srcDoc={src}
      sandbox="allow-same-origin"
      className="w-full rounded-lg border border-gray-200 bg-white"
      style={{ height: '520px', display: 'block' }}
    />
  );
}

// ── Confirm-delete modal ──────────────────────────────────────────────────────

function DeleteModal({ onConfirm, onCancel, isPending }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 id="delete-heading" className="text-base font-semibold text-gray-900">
          Remove custom branding?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          This will delete your custom email wrapper. All future emails will use the system default template.
        </p>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
          >
            {isPending ? 'Removing…' : 'Remove branding'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EmailBrandingPage() {
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const branding = useGetEmailBranding(userId);
  const upsert   = useUpsertEmailBranding(userId);
  const patch    = usePatchEmailBranding(userId);
  const del      = useDeleteEmailBranding(userId);

  // ── Local editor state ───────────────────────────────────────────────────
  const [html, setHtml]           = useState('');
  const [isActive, setIsActive]   = useState(true);
  const [saveOk, setSaveOk]       = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteOk, setDeleteOk]   = useState(false);

  // Populate editor from server state once loaded
  const initialized = useRef(false);
  useEffect(() => {
    if (!branding.isLoading && !initialized.current) {
      initialized.current = true;
      if (branding.data) {
        setHtml(branding.data.wrapperHtml);
        setIsActive(branding.data.isActive);
      } else {
        // No wrapper set yet — pre-fill with default template
        setHtml(DEFAULT_WRAPPER);
        setIsActive(true);
      }
    }
  }, [branding.isLoading, branding.data]);

  // ── Validation ───────────────────────────────────────────────────────────
  const missingPlaceholder = html.trim().length > 0 && !html.includes('{{body}}');

  // ── Save handler ─────────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault();
    setSaveOk(false);
    try {
      await upsert.mutateAsync({ wrapperHtml: html, isActive });
      setSaveOk(true);
    } catch { /* error rendered from upsert.error */ }
  }

  // Toggle active-only via PATCH (no HTML re-send needed)
  async function handleToggleActive(value) {
    setIsActive(value);
    if (branding.data) {
      try {
        await patch.mutateAsync({ isActive: value });
      } catch { /* ignore; optimistic UI already updated */ }
    }
  }

  // ── Delete handler ───────────────────────────────────────────────────────
  async function handleDelete() {
    try {
      await del.mutateAsync();
      setShowDelete(false);
      setDeleteOk(true);
      initialized.current = false; // allow re-population with default
      setHtml(DEFAULT_WRAPPER);
      setIsActive(true);
    } catch { /* error rendered from del.error */ }
  }

  const saveError = upsert.error?.response?.data?.error?.message
    ?? upsert.error?.message
    ?? null;
  const deleteError = del.error?.response?.data?.error?.message
    ?? del.error?.message
    ?? null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
      {showDelete && (
        <DeleteModal
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          isPending={del.isPending}
        />
      )}

      <div className="sm:mx-auto sm:w-full sm:max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
              <span className="text-sm font-bold text-white select-none">RMS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Email Branding</h1>
          </div>
          <Link
            to="/profile"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            ← Back to profile
          </Link>
        </div>

        {/* Description */}
        <p className="mb-6 text-sm text-gray-600">
          Customise the HTML wrapper used when sending reminder emails to your subscribers.
          The <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-indigo-700">{'{{body}}'}</code> placeholder
          will be replaced with the reminder content.
        </p>

        {/* Loading skeleton */}
        {branding.isLoading && (
          <div className="bg-white px-6 py-12 shadow sm:rounded-lg text-center text-sm text-gray-500">
            Loading…
          </div>
        )}

        {!branding.isLoading && (
          <form onSubmit={handleSave} noValidate>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* ── Left: Editor ── */}
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">HTML Template</h2>
                  <div className="flex items-center gap-3">
                    {/* Active toggle */}
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => handleToggleActive(e.target.checked)}
                        aria-label="Enable custom branding"
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                      />
                      Active
                    </label>
                    {/* Insert default */}
                    <button
                      type="button"
                      onClick={() => { setHtml(DEFAULT_WRAPPER); initialized.current = true; }}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      Insert default
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {/* Banners */}
                  {saveOk && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200"
                    >
                      Branding saved successfully.
                    </div>
                  )}
                  {deleteOk && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800 ring-1 ring-blue-200"
                    >
                      Custom branding removed. System default will be used.
                    </div>
                  )}
                  {saveError && (
                    <div
                      role="alert"
                      className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
                    >
                      {saveError}
                    </div>
                  )}
                  {deleteError && (
                    <div
                      role="alert"
                      className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
                    >
                      {deleteError}
                    </div>
                  )}
                  {missingPlaceholder && (
                    <div
                      role="alert"
                      className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200"
                    >
                      Your template must include the{' '}
                      <code className="font-mono text-xs">{'{{body}}'}</code> placeholder.
                    </div>
                  )}

                  {/* Textarea */}
                  <div>
                    <label htmlFor="html-editor" className="sr-only">HTML template</label>
                    <textarea
                      id="html-editor"
                      aria-label="HTML template"
                      value={html}
                      onChange={(e) => { setHtml(e.target.value); setSaveOk(false); }}
                      rows={22}
                      spellCheck={false}
                      className={[
                        'block w-full rounded-md border-0 px-3 py-2 font-mono text-xs text-gray-800',
                        'outline outline-1 -outline-offset-1',
                        'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
                        'resize-y leading-relaxed',
                        missingPlaceholder ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-gray-50',
                      ].join(' ')}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={upsert.isPending || missingPlaceholder || !html.trim()}
                      aria-label="Save branding"
                      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                                 hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline
                                 focus-visible:outline-2 focus-visible:outline-offset-2
                                 focus-visible:outline-indigo-600"
                    >
                      {upsert.isPending ? 'Saving…' : 'Save branding'}
                    </button>

                    {branding.data && (
                      <button
                        type="button"
                        onClick={() => setShowDelete(true)}
                        aria-label="Remove branding"
                        className="rounded-md px-4 py-2 text-sm font-medium text-red-600 bg-white ring-1
                                   ring-inset ring-red-300 hover:bg-red-50"
                      >
                        Remove branding
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Right: Live Preview ── */}
              <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">
                    Live Preview
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      (sample content injected)
                    </span>
                  </h2>
                </div>
                <div className="p-4">
                  {html.includes('{{body}}') ? (
                    <LivePreview html={html} />
                  ) : (
                    <div className="flex h-40 items-center justify-center text-sm text-gray-400">
                      Add the <code className="mx-1 rounded bg-gray-100 px-1 font-mono text-xs">{'{{body}}'}</code>
                      placeholder to see a preview.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
