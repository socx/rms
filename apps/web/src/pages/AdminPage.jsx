import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStoredUserId } from '../hooks/useAuth.js';
import { useGetProfile } from '../hooks/useProfile.js';
import {
  useAdminUsers,
  useAdminUpdateUser,
  useAdminSettings,
  useAdminUpdateSetting,
  useAdminEvents,
} from '../hooks/useAdmin.js';

// ── Status / role badge helpers ───────────────────────────────────────────────

const USER_STATUS_STYLES = {
  ACTIVE:   'bg-green-100 text-green-700',
  DISABLED: 'bg-yellow-100 text-yellow-700',
  DELETED:  'bg-red-100 text-red-700',
};

const ROLE_STYLES = {
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

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const currentUserId = getStoredUserId();
  const [query, setQuery]   = useState('');
  const [search, setSearch] = useState('');
  const users      = useAdminUsers({ q: search });
  const updateUser = useAdminUpdateUser();

  function handleSearch(e) {
    e.preventDefault();
    setSearch(query);
  }

  return (
    <section aria-label="Users">
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
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
                              className="rounded px-2 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
                            >
                              {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              aria-label={u.systemRole === 'SYSTEM_ADMIN'
                                ? `Demote ${u.email} from admin`
                                : `Promote ${u.email} to admin`}
                              onClick={() => updateUser.mutate({
                                id: u.id,
                                systemRole: u.systemRole === 'SYSTEM_ADMIN' ? 'USER' : 'SYSTEM_ADMIN',
                              })}
                              className="rounded px-2 py-1 text-xs font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-700"
                            >
                              {u.systemRole === 'SYSTEM_ADMIN' ? 'Demote' : 'Promote'}
                            </button>
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

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'users',    label: 'Users' },
  { key: 'settings', label: 'Settings' },
  { key: 'events',   label: 'Events' },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const userId   = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const profile = useGetProfile(userId);

  useEffect(() => {
    if (
      profile.isSuccess &&
      String(profile.data?.systemRole).toLowerCase() !== 'system_admin'
    ) {
      navigate('/events', { replace: true });
    }
  }, [profile.isSuccess, profile.data, navigate]);

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
    String(profile.data?.systemRole).toLowerCase() !== 'system_admin'
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
          <UsersTab />
        </div>
        <div hidden={activeTab !== 'settings'}>
          <SettingsTab />
        </div>
        <div hidden={activeTab !== 'events'}>
          <EventsTab />
        </div>
      </main>
    </div>
  );
}
