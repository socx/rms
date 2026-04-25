import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStoredUserId } from '../hooks/useAuth.js';
import { useGetProfile } from '../hooks/useProfile.js';
import {
  useAdminUsers,
  useAdminUpdateUser,
  useAdminDeleteUser,
  useAdminSettings,
  useAdminUpdateSetting,
  useAdminEvents,
  useAdminCreateUser,
  useAdminAuditLogs,
  useAdminLogs,
} from '../hooks/useAdmin.js';

// ── Status / role badge helpers ───────────────────────────────────────────────

const USER_STATUS_STYLES = {
  ACTIVE:   'bg-green-100 text-green-700',
  DISABLED: 'bg-yellow-100 text-yellow-700',
  DELETED:  'bg-red-100 text-red-700',
};

const ROLE_STYLES = {
  SUPER_ADMIN:  'bg-purple-200 text-purple-800',
  SYSTEM_ADMIN: 'bg-purple-100 text-purple-700',
  USER:         'bg-gray-100 text-gray-600',
};

const EVENT_STATUS_STYLES = {
  ACTIVE:    'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  ARCHIVED:  'bg-gray-100 text-gray-500',
};

function StatusBadge({ label, styleMap, value }) {
  const cls = styleMap[value] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      aria-label={`${label}: ${value}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {value.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

// ── Create User modal ─────────────────────────────────────────────────────────

function CreateUserModal({ onClose }) {
  const createUser = useAdminCreateUser();
  const [form, setForm] = useState({ firstname: '', lastname: '', email: '', password: '', systemRole: 'USER' });
  const [err, setErr] = useState(null);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    try {
      await createUser.mutateAsync(form);
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error?.message ?? 'Failed to create user.');
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="create-user-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="create-user-heading" className="text-base font-semibold text-gray-900 mb-4">Create User</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">First name</label>
              <input required value={form.firstname} onChange={e => set('firstname', e.target.value)}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Last name</label>
              <input required value={form.lastname} onChange={e => set('lastname', e.target.value)}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input required type="password" minLength={8} value={form.password} onChange={e => set('password', e.target.value)}
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select value={form.systemRole} onChange={e => set('systemRole', e.target.value)}
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="USER">User</option>
              <option value="SYSTEM_ADMIN">System Admin</option>
            </select>
          </div>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-3 justify-end mt-2">
            <button type="button" onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={createUser.isPending}
              className="rounded-md px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
              {createUser.isPending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ callerRole }) {
  const currentUserId = getStoredUserId();
  const isSuperAdmin = callerRole === 'super_admin';
  const [query, setQuery]           = useState('');
  const [search, setSearch]         = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError,  setDeleteError]  = useState(null);
  const [showCreate, setShowCreate]     = useState(false);
  const users      = useAdminUsers({ q: search });
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

  function handleSearch(e) {
    e.preventDefault();
    setSearch(query);
  }

  async function handleDeleteConfirm() {
    setDeleteError(null);
    try {
      await deleteUser.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err?.response?.data?.error?.message ?? err?.message ?? 'Delete failed.');
    }
  }

  return (
    <section aria-label="Users">
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 id="delete-user-heading" className="text-base font-semibold text-gray-900">
              Delete user?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              <strong>{deleteTarget.name}</strong> will be soft-deleted. This cannot be undone.
            </p>
            {deleteError && (
              <p role="alert" className="mt-2 text-sm text-red-600">{deleteError}</p>
            )}
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleteUser.isPending}
                aria-label={`Confirm delete ${deleteTarget.name}`}
                className="rounded-md px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
              >
                {deleteUser.isPending ? 'Deleting…' : 'Delete user'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search users"
            className="block w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
          />
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Search
          </button>
        </form>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="ml-auto rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
        >
          + Create user
        </button>
      </div>

      {users.isPending && <p className="text-sm text-gray-500">Loading users…</p>}
      {users.isError   && <p className="text-sm text-red-600">Failed to load users.</p>}

      {users.isSuccess && (
        users.data.length === 0
          ? <p aria-label="No users" className="text-sm text-gray-500 py-8 text-center">No users found.</p>
          : (
            <div className="overflow-x-auto">
              <table aria-label="Users list" className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-900">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-900">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-900">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-900">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {users.data.map(u => (
                    <tr key={u.id} aria-label={`User: ${u.email}`}>
                      <td className="px-4 py-3 text-gray-900">{u.firstname} {u.lastname}</td>
                      <td className="px-4 py-3 text-gray-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <StatusBadge label="User role" styleMap={ROLE_STYLES} value={u.systemRole} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label="User status" styleMap={USER_STATUS_STYLES} value={u.status} />
                      </td>
                      <td className="px-4 py-3 flex gap-2">
                        {u.id !== currentUserId && (
                          <>
                            <button
                              aria-label={`${u.status === 'ACTIVE' ? 'Disable' : 'Enable'} ${u.firstname} ${u.lastname}`}
                              onClick={() => updateUser.mutate({ id: u.id, status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}
                              disabled={!isSuperAdmin && (u.systemRole === 'SYSTEM_ADMIN' || u.systemRole === 'SUPER_ADMIN')}
                              className="rounded px-2 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                            </button>
                            {(isSuperAdmin || (u.systemRole !== 'SYSTEM_ADMIN' && u.systemRole !== 'SUPER_ADMIN')) && (
                              <button
                                aria-label={u.systemRole === 'SYSTEM_ADMIN'
                                  ? `Demote ${u.email} from admin`
                                  : u.systemRole === 'SUPER_ADMIN'
                                  ? `Demote ${u.email} from super admin`
                                  : `Promote ${u.email} to admin`}
                                onClick={() => updateUser.mutate({
                                  id: u.id,
                                  systemRole: (u.systemRole === 'SYSTEM_ADMIN' || u.systemRole === 'SUPER_ADMIN') ? 'USER' : 'SYSTEM_ADMIN',
                                })}
                                className="rounded px-2 py-1 text-xs font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-700"
                              >
                                {(u.systemRole === 'SYSTEM_ADMIN' || u.systemRole === 'SUPER_ADMIN') ? 'Demote' : 'Promote'}
                              </button>
                            )}
                            {isSuperAdmin && u.systemRole !== 'SUPER_ADMIN' && (
                              <button
                                aria-label={`Promote ${u.email} to super admin`}
                                onClick={() => updateUser.mutate({ id: u.id, systemRole: 'SUPER_ADMIN' })}
                                className="rounded px-2 py-1 text-xs font-medium bg-purple-50 hover:bg-purple-100 text-purple-700"
                              >
                                → Super Admin
                              </button>
                            )}
                            {u.status !== 'DELETED' && isSuperAdmin && (
                              <button
                                aria-label={`Delete ${u.firstname} ${u.lastname}`}
                                onClick={() => { setDeleteError(null); setDeleteTarget({ id: u.id, name: `${u.firstname} ${u.lastname}` }); }}
                                className="rounded px-2 py-1 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700"
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </section>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const settings       = useAdminSettings();
  const updateSetting  = useAdminUpdateSetting();
  const [editingKey, setEditingKey] = useState(null);
  const [editValue,  setEditValue]  = useState('');

  function startEdit(key, value) {
    updateSetting.reset();
    setEditingKey(key);
    setEditValue(value);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue('');
    updateSetting.reset();
  }

  async function saveSetting(key) {
    try {
      await updateSetting.mutateAsync({ key, value: editValue });
      setEditingKey(null);
    } catch { /* error displayed inline */ }
  }

  return (
    <section aria-label="Settings">
      {settings.isPending && <p className="text-sm text-gray-500">Loading settings…</p>}
      {settings.isError   && <p className="text-sm text-red-600">Failed to load settings.</p>}

      {settings.isSuccess && (
        <div className="overflow-x-auto">
          <table aria-label="Settings list" className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-900">Key</th>
                <th className="px-4 py-3 text-left font-medium text-gray-900">Description</th>
                <th className="px-4 py-3 text-left font-medium text-gray-900">Value</th>
                <th className="px-4 py-3 text-left font-medium text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {settings.data.map(s => (
                <tr key={s.key} aria-label={`Setting: ${s.key}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{s.key}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs">{s.description ?? '—'}</td>
                  <td className="px-4 py-3">
                    {editingKey === s.key
                      ? (
                        <input
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          aria-label={`Value for ${s.key}`}
                          className="block w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"
                        />
                      )
                      : (
                        <span
                          aria-label={`Current value: ${s.value}`}
                          className="font-mono text-xs text-gray-700 break-all"
                        >
                          {s.value}
                        </span>
                      )
                    }
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === s.key
                      ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-2">
                            <button
                              aria-label={`Save ${s.key}`}
                              onClick={() => saveSetting(s.key)}
                              disabled={updateSetting.isPending}
                              className="rounded px-2 py-1 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              aria-label={`Cancel ${s.key}`}
                              onClick={cancelEdit}
                              className="rounded px-2 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                          {updateSetting.isError && (
                            <p className="text-xs text-red-600">
                              {updateSetting.error?.response?.data?.error?.message ?? 'Failed to save.'}
                            </p>
                          )}
                        </div>
                      )
                      : (
                        <button
                          aria-label={`Edit ${s.key}`}
                          onClick={() => startEdit(s.key, s.value)}
                          className="rounded px-2 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
                        >
                          Edit
                        </button>
                      )
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

function EventsTab() {
  const [page, setPage] = useState(1);
  const perPage = 20;
  const events = useAdminEvents({ page, perPage });

  const meta       = events.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / perPage) : 1;
  const list       = events.data?.data?.events ?? [];

  return (
    <section aria-label="Events">
      {events.isPending && <p className="text-sm text-gray-500">Loading events…</p>}
      {events.isError   && <p className="text-sm text-red-600">Failed to load events.</p>}

      {events.isSuccess && (
        <>
          {list.length === 0
            ? <p aria-label="No events" className="text-sm text-gray-500 py-8 text-center">No events found.</p>
            : (
              <div className="overflow-x-auto">
                <table aria-label="Events list" className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-900">Subject</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-900">Owner</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-900">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-900">Date</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-900">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {list.map(e => (
                      <tr key={e.id} aria-label={`Event: ${e.subject}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">{e.subject}</td>
                        <td
                          className="px-4 py-3 text-gray-600"
                          aria-label={`Owner: ${e.owner.email}`}
                        >
                          {e.owner.firstname} {e.owner.lastname}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge label="Event status" styleMap={EVENT_STATUS_STYLES} value={e.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(e.eventDatetime).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {new Date(e.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }

          {totalPages > 1 && (
            <nav aria-label="Events pagination" className="mt-4 flex items-center gap-3 justify-end">
              <button
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="rounded px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <button
                aria-label="Next page"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="rounded px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

// ── Audit tab ─────────────────────────────────────────────────────────────────

const AUDIT_ACTION_STYLES = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
};

function AuditTab() {
  const [filters, setFilters] = useState({ entityType: '', action: '', dateFrom: '', dateTo: '' });
  const [applied, setApplied] = useState({});
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const audit = useAdminAuditLogs({ ...applied, limit, offset });
  const logs  = audit.data?.data?.logs ?? [];
  const total = audit.data?.meta?.total ?? 0;

  function applyFilters(e) {
    e.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  }

  return (
    <section aria-label="Audit logs">
      <form onSubmit={applyFilters} className="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Entity type</label>
          <select value={filters.entityType} onChange={e => setFilters(f => ({ ...f, entityType: e.target.value }))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">All</option>
            <option value="EVENT">Event</option>
            <option value="REMINDER">Reminder</option>
            <option value="SUBSCRIBER">Subscriber</option>
            <option value="USER">User</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Action</label>
          <select value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">All</option>
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
          <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          Apply
        </button>
      </form>

      {audit.isPending && <p className="text-sm text-gray-500">Loading audit logs…</p>}
      {audit.isError   && <p className="text-sm text-red-600">Failed to load audit logs.</p>}

      {audit.isSuccess && (
        logs.length === 0
          ? <p className="text-sm text-gray-500 py-8 text-center">No audit logs found.</p>
          : (
            <>
              <div className="overflow-x-auto">
                <table aria-label="Audit log" className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">Time</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">Actor</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">Action</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">Type</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">Summary</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-900">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(l.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{l.actorEmail}</td>
                        <td className="px-3 py-2">
                          <StatusBadge label="Action" styleMap={AUDIT_ACTION_STYLES} value={l.action} />
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 capitalize">{l.entityType.toLowerCase()}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 max-w-xs truncate">{l.entitySummary ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{l.ipAddress ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav aria-label="Audit pagination" className="mt-4 flex items-center gap-3 justify-end">
                <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - limit))}
                  className="rounded px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40">
                  Previous
                </button>
                <span className="text-sm text-gray-600">{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
                <button disabled={offset + limit >= total} onClick={() => setOffset(o => o + limit)}
                  className="rounded px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40">
                  Next
                </button>
              </nav>
            </>
          )
      )}
    </section>
  );
}

// ── Logs tab (super_admin only) ───────────────────────────────────────────────

function LogsTab() {
  const [tier,   setTier]   = useState('api');
  const [stream, setStream] = useState('out');
  const [lines,  setLines]  = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logs = useAdminLogs({ tier, stream, lines });

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => logs.refetch(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, logs]);

  return (
    <section aria-label="Log viewer">
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tier</label>
          <select value={tier} onChange={e => setTier(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="api">API</option>
            <option value="worker">Worker</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Stream</label>
          <select value={stream} onChange={e => setStream(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="out">stdout</option>
            <option value="error">stderr</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lines</label>
          <select value={lines} onChange={e => setLines(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value={50}>50</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
        <button onClick={() => logs.refetch()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          Refresh
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
            className="rounded border-gray-300" />
          Auto-refresh (5s)
        </label>
      </div>

      {logs.isPending && <p className="text-sm text-gray-500">Loading logs…</p>}
      {logs.isError   && <p className="text-sm text-red-600">Failed to load logs.</p>}

      {logs.isSuccess && (
        logs.data.lines?.length === 0
          ? <p className="text-sm text-gray-500 py-4">{logs.data.message ?? 'No log entries.'}</p>
          : (
            <pre
              aria-label={`${tier} ${stream} logs`}
              className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all"
            >
              {(logs.data.lines ?? []).join('\n')}
            </pre>
          )
      )}
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const profile = useGetProfile(userId);
  const callerRole = profile.data?.systemRole ? String(profile.data.systemRole).toLowerCase() : '';
  const isSuperAdmin = callerRole === 'super_admin';

  useEffect(() => {
    if (
      profile.isSuccess &&
      (String(profile.data?.systemRole).toLowerCase() !== 'system_admin' &&
       String(profile.data?.systemRole).toLowerCase() !== 'super_admin')
    ) {
      navigate('/events', { replace: true });
    }
  }, [profile.isSuccess, profile.data, navigate]);

  const TABS = [
    { key: 'users',    label: 'Users' },
    { key: 'settings', label: 'Settings' },
    { key: 'events',   label: 'Events' },
    { key: 'audit',    label: 'Audit' },
    ...(isSuperAdmin ? [{ key: 'logs', label: 'Logs' }] : []),
  ];

  const [activeTab, setActiveTab] = useState('users');

  if (!userId || profile.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (
    profile.isSuccess &&
    String(profile.data?.systemRole).toLowerCase() !== 'system_admin' &&
    String(profile.data?.systemRole).toLowerCase() !== 'super_admin'
  ) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link to="/events" className="text-sm text-indigo-600 hover:underline">
          ← Events
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">Admin Panel</h1>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6" aria-label="Admin panel">
        <div role="tablist" className="flex gap-1 border-b border-gray-200 mb-6">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                'px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px',
                activeTab === t.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div hidden={activeTab !== 'users'}>
          <UsersTab callerRole={callerRole} />
        </div>
        <div hidden={activeTab !== 'settings'}>
          <SettingsTab />
        </div>
        <div hidden={activeTab !== 'events'}>
          <EventsTab />
        </div>
        <div hidden={activeTab !== 'audit'}>
          <AuditTab />
        </div>
        {isSuperAdmin && (
          <div hidden={activeTab !== 'logs'}>
            <LogsTab />
          </div>
        )}
      </main>
    </div>
  );
}

