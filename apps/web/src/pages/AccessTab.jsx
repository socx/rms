import React, { useState } from 'react';
import {
  useListGrants,
  useCreateGrant,
  useUpdateGrant,
  useDeleteGrant,
} from '../hooks/useGrants.js';

// ── Constants ──────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'CONTRIBUTOR', label: 'Contributor' },
  { value: 'READER',      label: 'Reader' },
];

const ROLE_DESCRIPTIONS = {
  CONTRIBUTOR: 'Can view and edit event content, manage reminders and subscribers.',
  READER:      'Can view the event and its subscribers, but cannot make changes.',
};

// ── Helpers ────────────────────────────────────────────────────────────────

const inputClass =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600';

const selectClass = inputClass;

function RoleBadge({ role }) {
  const styles = {
    CONTRIBUTOR: 'bg-blue-100 text-blue-700',
    READER:      'bg-gray-100 text-gray-600',
  };
  return (
    <span
      aria-label={`Role: ${role}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[role] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {role.charAt(0) + role.slice(1).toLowerCase()}
    </span>
  );
}

// ── Add Grant Modal ────────────────────────────────────────────────────────

function AddGrantModal({ eventId, onClose }) {
  const createGrant = useCreateGrant();
  const [userId, setUserId] = useState('');
  const [role,   setRole]   = useState('CONTRIBUTOR');
  const [error,  setError]  = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!userId.trim()) { setError('User ID is required.'); return; }

    try {
      await createGrant.mutateAsync({ eventId, userId: userId.trim(), role });
      onClose();
    } catch (err) {
      const code    = err?.response?.data?.error?.code;
      const message = err?.response?.data?.error?.message;
      if (code === 'USER_IS_OWNER')  { setError('That user is already the owner of this event.'); return; }
      if (code === 'USER_NOT_FOUND') { setError('No active user found with that ID.'); return; }
      if (code === 'ACCESS_EXISTS')  { setError('That user already has access. Edit their role instead.'); return; }
      setError(message ?? err?.message ?? 'Failed to grant access.');
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Grant access" className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">Grant access</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Grant access form">
            {error && (
              <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="grant-user-id" className="block text-sm font-medium text-gray-700 mb-1">
                User ID <span aria-hidden className="text-red-500">*</span>
              </label>
              <input
                id="grant-user-id"
                type="text"
                value={userId}
                onChange={e => setUserId(e.target.value)}
                placeholder="Paste user UUID"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">The UUID of the user you want to grant access to.</p>
            </div>

            <div>
              <label htmlFor="grant-role" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select id="grant-role" value={role} onChange={e => setRole(e.target.value)} className={selectClass}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">{ROLE_DESCRIPTIONS[role]}</p>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={createGrant.isPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">
                {createGrant.isPending ? 'Granting…' : 'Grant access'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Edit Role Modal ────────────────────────────────────────────────────────

function EditRoleModal({ eventId, grant, onClose }) {
  const updateGrant = useUpdateGrant();
  const [role,  setRole]  = useState(grant.role);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await updateGrant.mutateAsync({ eventId, userId: grant.userId, role });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to update role.');
    }
  }

  const name = `${grant.user.firstname} ${grant.user.lastname}`;

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit access role" className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-1">Edit role</h2>
          <p className="text-sm text-gray-500 mb-4">{name}</p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Edit access role form">
            {error && (
              <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="edit-grant-role" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select id="edit-grant-role" value={role} onChange={e => setRole(e.target.value)} className={selectClass}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">{ROLE_DESCRIPTIONS[role]}</p>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={updateGrant.isPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">
                {updateGrant.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Grant Row ──────────────────────────────────────────────────────────────

function GrantRow({ grant, eventId }) {
  const [showEdit,    setShowEdit]    = useState(false);
  const [showRevoke,  setShowRevoke]  = useState(false);
  const [revokeError, setRevokeError] = useState(null);

  const deleteGrant = useDeleteGrant();

  const name  = `${grant.user.firstname} ${grant.user.lastname}`;
  const email = grant.user.email;

  async function handleRevoke() {
    setRevokeError(null);
    try {
      await deleteGrant.mutateAsync({ eventId, userId: grant.userId });
      setShowRevoke(false);
    } catch (err) {
      setRevokeError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to revoke access.');
    }
  }

  return (
    <>
      <li
        className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3"
        aria-label={`Grant: ${name}`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
          <p className="text-xs text-gray-400 truncate">{email}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <RoleBadge role={grant.role} />
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            aria-label={`Edit role for ${name}`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            Edit role
          </button>
          <button
            type="button"
            onClick={() => setShowRevoke(true)}
            aria-label={`Revoke access for ${name}`}
            className="text-xs font-medium text-red-600 hover:text-red-500"
          >
            Revoke
          </button>
        </div>
      </li>

      {showEdit && (
        <EditRoleModal eventId={eventId} grant={grant} onClose={() => setShowEdit(false)} />
      )}

      {showRevoke && (
        <div role="dialog" aria-modal="true" aria-label="Confirm revoke access" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowRevoke(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Revoke access for {name}?</h3>
            <p className="text-sm text-gray-600">
              {name} ({email}) will no longer have access to this event.
            </p>
            {revokeError && (
              <p role="alert" className="text-sm text-red-600">{revokeError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRevoke(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={deleteGrant.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60"
              >
                {deleteGrant.isPending ? 'Revoking…' : 'Revoke access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Access Tab ─────────────────────────────────────────────────────────────

/**
 * Props:
 *  eventId  – string
 *  isOwner  – boolean  (only owners can see/use this tab)
 */
export default function AccessTab({ eventId, isOwner }) {
  const { data: grants = [], isLoading, isError, error } = useListGrants(eventId);
  const [showAdd, setShowAdd] = useState(false);

  if (!isOwner) {
    return (
      <div className="rounded-md bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
        Only the event owner can manage access.
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500 py-4">Loading access…</p>;
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
        {error?.response?.data?.error?.message ?? error?.message ?? 'Failed to load access grants.'}
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Access">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Access{grants.length > 0 ? ` (${grants.length})` : ''}
        </h2>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          + Grant access
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-400">
        These users have been granted access to this event. You are the owner and always have full access.
      </p>

      {/* List */}
      {grants.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">No access grants yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Access grants list">
          {grants.map(g => (
            <GrantRow key={g.id} grant={g} eventId={eventId} />
          ))}
        </ul>
      )}

      {showAdd && (
        <AddGrantModal eventId={eventId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
