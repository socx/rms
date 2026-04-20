import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getStoredUserId } from '../hooks/useAuth.js';
import {
  useListApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useSetApiKeyScopes,
  useRevokeApiKey,
} from '../hooks/useApiKeys.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_SCOPES = [
  'users:read',
  'events:read',
  'events:write',
  'subscribers:read',
  'subscribers:write',
  'reports:read',
];

// ── Validation schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  name:       z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  scopes:     z.array(z.string()).default([]),
  expires_at: z
    .string()
    .optional()
    .refine(v => !v || !isNaN(new Date(v).getTime()), { message: 'Must be a valid date' })
    .refine(v => !v || new Date(v) > new Date(), { message: 'Expiry must be in the future' }),
});

const editSchema = z.object({
  name:       z.string().min(1, 'Name is required').max(100),
  expires_at: z
    .string()
    .optional()
    .refine(v => !v || !isNaN(new Date(v).getTime()), { message: 'Must be a valid date' })
    .refine(v => !v || new Date(v) > new Date(), { message: 'Expiry must be in the future' }),
});

// ── Small helpers ─────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function StatusBadge({ status }) {
  const active = status === 'active';
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
      ].join(' ')}
    >
      {active ? 'Active' : 'Revoked'}
    </span>
  );
}

function ScopeCheckboxes({ value, onChange, disabled }) {
  const toggle = (scope) => {
    onChange(value.includes(scope) ? value.filter(s => s !== scope) : [...value, scope]);
  };
  return (
    <fieldset className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      <legend className="sr-only">Scopes</legend>
      {ALL_SCOPES.map(scope => (
        <label key={scope} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
            checked={value.includes(scope)}
            onChange={() => toggle(scope)}
            disabled={disabled}
            aria-label={scope}
          />
          <span>{scope}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Alert({ type, children }) {
  const cls = type === 'success'
    ? 'bg-green-50 text-green-800 ring-green-200'
    : 'bg-red-50 text-red-700 ring-red-200';
  return (
    <div role={type === 'error' ? 'alert' : 'status'} aria-live="polite"
      className={`rounded-md px-4 py-3 text-sm ring-1 ${cls}`}>
      {children}
    </div>
  );
}

// ── Create key modal ──────────────────────────────────────────────────────────

function CreateModal({ userId, onClose }) {
  const createKey = useCreateApiKey(userId);
  const [rawKey, setRawKey] = useState(null);

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', scopes: [], expires_at: '' },
  });

  async function onSubmit(values) {
    try {
      const payload = { name: values.name, scopes: values.scopes };
      if (values.expires_at) payload.expires_at = new Date(values.expires_at).toISOString();
      const key = await createKey.mutateAsync(payload);
      setRawKey(key.raw_key);
    } catch { /* error shown from mutation */ }
  }

  const apiError = createKey.error?.response?.data?.error?.message
    ?? createKey.error?.message ?? null;

  // ── Raw key reveal step ───────────────────────────────────────────────────
  if (rawKey) {
    return (
      <Dialog title="API key created" onClose={onClose}>
        <Alert type="success">Copy your key now — it will not be shown again.</Alert>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-900 mb-1">Your API key</label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Raw API key"
              value={rawKey}
              className="block w-full rounded-md bg-gray-50 px-3 py-1.5 text-sm font-mono text-gray-900
                         outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-indigo-600"
            />
            <button
              type="button"
              aria-label="Copy API key"
              onClick={() => navigator.clipboard?.writeText(rawKey)}
              className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white
                         hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Copy
            </button>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-indigo-500"
          >
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Create API key" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {apiError && <Alert type="error">{apiError}</Alert>}

        <div>
          <label htmlFor="new-key-name" className="block text-sm font-medium text-gray-900">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="new-key-name"
            type="text"
            placeholder="CRM integration"
            aria-describedby={errors.name ? 'new-key-name-error' : undefined}
            aria-invalid={errors.name ? 'true' : undefined}
            className={[
              'mt-2 block w-full rounded-md px-3 py-1.5 text-sm text-gray-900',
              'outline outline-1 -outline-offset-1 placeholder:text-gray-400',
              'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
              errors.name ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
            ].join(' ')}
            {...register('name')}
          />
          {errors.name && (
            <p id="new-key-name-error" className="mt-1 text-xs text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-900">
            Scopes <span className="text-gray-400 font-normal">(empty = unrestricted)</span>
          </span>
          <Controller
            name="scopes"
            control={control}
            render={({ field }) => (
              <ScopeCheckboxes value={field.value} onChange={field.onChange} />
            )}
          />
        </div>

        <div>
          <label htmlFor="new-key-expires" className="block text-sm font-medium text-gray-900">
            Expires at <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="new-key-expires"
            type="datetime-local"
            aria-describedby={errors.expires_at ? 'new-key-expires-error' : undefined}
            aria-invalid={errors.expires_at ? 'true' : undefined}
            className={[
              'mt-2 block w-full rounded-md px-3 py-1.5 text-sm text-gray-900',
              'outline outline-1 -outline-offset-1 placeholder:text-gray-400',
              'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
              errors.expires_at ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
            ].join(' ')}
            {...register('expires_at')}
          />
          {errors.expires_at && (
            <p id="new-key-expires-error" className="mt-1 text-xs text-red-600">{errors.expires_at.message}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300
                       hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                       hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Edit key modal ────────────────────────────────────────────────────────────

function EditModal({ userId, apiKey, onClose }) {
  const updateKey = useUpdateApiKey(userId);
  const setScopes = useSetApiKeyScopes(userId);

  const existingExpiry = apiKey.expires_at
    // Convert ISO string to the datetime-local input format YYYY-MM-DDTHH:mm
    ? (() => {
        const d = new Date(apiKey.expires_at);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })()
    : '';

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(editSchema),
    defaultValues: { name: apiKey.name, expires_at: existingExpiry },
  });

  const [scopes, setScopes_] = useState(apiKey.scopes ?? []);
  const [ok, setOk] = useState(false);

  async function onSubmit(values) {
    try {
      setOk(false);
      const updates = [
        updateKey.mutateAsync({ keyId: apiKey.id, name: values.name, expires_at: values.expires_at || null }),
        setScopes.mutateAsync({ keyId: apiKey.id, scopes }),
      ];
      await Promise.all(updates);
      setOk(true);
    } catch { /* errors rendered below */ }
  }

  const apiError = updateKey.error?.response?.data?.error?.message
    ?? setScopes.error?.response?.data?.error?.message
    ?? updateKey.error?.message
    ?? setScopes.error?.message
    ?? null;

  return (
    <Dialog title={`Edit "${apiKey.name}"`} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {ok && <Alert type="success">Key updated successfully.</Alert>}
        {apiError && <Alert type="error">{apiError}</Alert>}

        <div>
          <label htmlFor="edit-key-name" className="block text-sm font-medium text-gray-900">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="edit-key-name"
            type="text"
            aria-invalid={errors.name ? 'true' : undefined}
            className={[
              'mt-2 block w-full rounded-md px-3 py-1.5 text-sm text-gray-900',
              'outline outline-1 -outline-offset-1',
              'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
              errors.name ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
            ].join(' ')}
            {...register('name')}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-900 mb-1">Scopes</span>
          <ScopeCheckboxes value={scopes} onChange={setScopes_} />
        </div>

        <div>
          <label htmlFor="edit-key-expires" className="block text-sm font-medium text-gray-900">
            Expires at <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="edit-key-expires"
            type="datetime-local"
            aria-invalid={errors.expires_at ? 'true' : undefined}
            className={[
              'mt-2 block w-full rounded-md px-3 py-1.5 text-sm text-gray-900',
              'outline outline-1 -outline-offset-1',
              'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
              errors.expires_at ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
            ].join(' ')}
            {...register('expires_at')}
          />
          {errors.expires_at && (
            <p className="mt-1 text-xs text-red-600">{errors.expires_at.message}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300
                       hover:bg-gray-50">
            Close
          </button>
          <button type="submit" disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                       hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Revoke confirm modal ──────────────────────────────────────────────────────

function RevokeModal({ userId, apiKey, onClose }) {
  const revokeKey = useRevokeApiKey(userId);
  const [done, setDone] = useState(false);

  async function confirm() {
    await revokeKey.mutateAsync(apiKey.id);
    setDone(true);
  }

  const apiError = revokeKey.error?.response?.data?.error?.message
    ?? revokeKey.error?.message ?? null;

  return (
    <Dialog title="Revoke API key" onClose={onClose}>
      {done ? (
        <>
          <Alert type="success">Key "{apiKey.name}" has been revoked.</Alert>
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Are you sure you want to revoke <strong className="font-semibold text-gray-900">"{apiKey.name}"</strong>?
            Any application using this key will immediately lose access.
            This action cannot be undone.
          </p>
          {apiError && <Alert type="error">{apiError}</Alert>}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300
                         hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={revokeKey.isPending}
              aria-label={`Confirm revoke ${apiKey.name}`}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                         hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {revokeKey.isPending ? 'Revoking…' : 'Revoke key'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

// ── Generic modal wrapper ─────────────────────────────────────────────────────

function Dialog({ title, onClose, children }) {
  // Close on Escape
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h3 id="dialog-title" className="text-base font-semibold text-gray-900 mb-4">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

// ── Key row ───────────────────────────────────────────────────────────────────

function KeyRow({ apiKey, onEdit, onRevoke }) {
  const revoked = apiKey.status === 'revoked';
  return (
    <tr className={revoked ? 'opacity-60' : ''}>
      <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
        <div>{apiKey.name}</div>
        <div className="mt-0.5 font-mono text-xs text-gray-400">{apiKey.key_prefix}…</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500 hidden sm:table-cell">
        <StatusBadge status={apiKey.status} />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500 hidden md:table-cell">
        {apiKey.scopes && apiKey.scopes.length > 0
          ? apiKey.scopes.join(', ')
          : <span className="text-gray-400">unrestricted</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500 hidden lg:table-cell">
        {formatDate(apiKey.expires_at)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500 hidden lg:table-cell">
        {apiKey.last_used_at ? formatDate(apiKey.last_used_at) : 'Never'}
      </td>
      <td className="whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm sm:pr-6">
        {!revoked && (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => onEdit(apiKey)}
              aria-label={`Edit ${apiKey.name}`}
              className="text-indigo-600 hover:text-indigo-900 font-medium"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onRevoke(apiKey)}
              aria-label={`Revoke ${apiKey.name}`}
              className="text-red-600 hover:text-red-900 font-medium"
            >
              Revoke
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const keys = useListApiKeys(userId);

  const [showCreate, setShowCreate] = useState(false);
  const [editing,    setEditing]    = useState(null);   // ApiKey object
  const [revoking,   setRevoking]   = useState(null);   // ApiKey object

  if (keys.isError) {
    const msg = keys.error?.response?.data?.error?.message ?? 'Failed to load API keys.';
    return (
      <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-4xl">
          <Alert type="error">{msg}</Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-4xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
              <span className="text-sm font-bold text-white select-none">RMS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">API Keys</h1>
          </div>
          <Link
            to="/profile"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            ← Back to profile
          </Link>
        </div>

        {/* Card */}
        <div className="bg-white shadow sm:rounded-lg">
          {/* Card header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Your API keys</h2>
              <p className="mt-1 text-sm text-gray-500">
                Keys grant programmatic access to the RMS API. Each key is shown only once.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              aria-label="Create key"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                         hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Create key
            </button>
          </div>

          {/* Table */}
          {keys.isLoading ? (
            <div className="px-6 py-12 text-center text-sm text-gray-500">Loading…</div>
          ) : !keys.data || keys.data.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-500">
              No API keys yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3 pl-4 pr-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:pl-6">
                      Name / Prefix
                    </th>
                    <th scope="col" className="hidden sm:table-cell px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="hidden md:table-cell px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Scopes
                    </th>
                    <th scope="col" className="hidden lg:table-cell px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Expires
                    </th>
                    <th scope="col" className="hidden lg:table-cell px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last used
                    </th>
                    <th scope="col" className="relative py-3 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {keys.data.map(key => (
                    <KeyRow
                      key={key.id}
                      apiKey={key}
                      onEdit={setEditing}
                      onRevoke={setRevoking}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Limit hint */}
        {keys.data && keys.data.filter(k => k.status === 'active').length >= 10 && (
          <p className="mt-4 text-center text-sm text-amber-600">
            You have reached the 10 active key limit. Revoke an existing key to create a new one.
          </p>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal userId={userId} onClose={() => setShowCreate(false)} />
      )}
      {editing && (
        <EditModal userId={userId} apiKey={editing} onClose={() => setEditing(null)} />
      )}
      {revoking && (
        <RevokeModal userId={userId} apiKey={revoking} onClose={() => setRevoking(null)} />
      )}
    </div>
  );
}
