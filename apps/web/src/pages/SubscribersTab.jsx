import React, { useState } from 'react';
import {
  useListSubscribers,
  useCreateSubscriber,
  useUpdateSubscriber,
  useDeleteSubscriber,
  useUnsubscribe,
  useAddContact,
  useUpdateContact,
  useDeleteContact,
} from '../hooks/useSubscribers.js';

// ── Constants ──────────────────────────────────────────────────────────────

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms',   label: 'SMS' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const inputClass =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600';

const selectClass = inputClass;

function SubscriberStatusBadge({ status }) {
  const styles = {
    ACTIVE:       'bg-green-100 text-green-700',
    UNSUBSCRIBED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      aria-label={`Subscriber status: ${status}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function PrimaryBadge() {
  return (
    <span
      aria-label="Primary contact"
      title="Primary contact"
      className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
    >
      Primary
    </span>
  );
}

// ── Add/Edit Contact Modal ─────────────────────────────────────────────────

function ContactFormModal({ eventId, subscriberId, contact = null, onClose }) {
  const isEdit = !!contact;
  const addContact    = useAddContact();
  const updateContact = useUpdateContact();

  const [channel,  setChannel]  = useState(contact ? contact.channel.toLowerCase() : 'email');
  const [value,    setValue]    = useState(contact?.contactValue ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [label,    setLabel]    = useState(contact?.label ?? '');
  const [status,   setStatus]   = useState(contact ? contact.status.toLowerCase() : 'active');
  const [error,    setError]    = useState(null);

  const mutation = isEdit ? updateContact : addContact;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) { setError('Contact value is required.'); return; }

    const payload = isEdit
      ? { eventId, subscriberId, contactId: contact.id, contact_value: value.trim(), is_primary: isPrimary, label: label.trim() || undefined, status }
      : { eventId, subscriberId, channel, contact_value: value.trim(), is_primary: isPrimary, label: label.trim() || undefined };

    try {
      await mutation.mutateAsync(payload);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to save contact.');
    }
  }

  const dialogLabel = isEdit ? 'Edit contact' : 'Add contact';

  return (
    <div role="dialog" aria-modal="true" aria-label={dialogLabel} className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">{dialogLabel}</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={`${dialogLabel} form`}>
            {error && (
              <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            {!isEdit && (
              <div>
                <label htmlFor="ct-channel" className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                <select id="ct-channel" value={channel} onChange={e => setChannel(e.target.value)} className={selectClass}>
                  {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="ct-value" className="block text-sm font-medium text-gray-700 mb-1">
                {isEdit ? 'Value' : (channel === 'email' ? 'Email address' : 'Phone number')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <input
                id="ct-value"
                type={channel === 'email' && !isEdit ? 'email' : 'text'}
                value={value}
                onChange={e => setValue(e.target.value)}
                className={inputClass}
                placeholder={channel === 'email' ? 'alice@example.com' : '+15551234567'}
              />
            </div>

            <div>
              <label htmlFor="ct-label" className="block text-sm font-medium text-gray-700 mb-1">Label <span className="text-xs text-gray-400">(optional)</span></label>
              <input id="ct-label" type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. work, cell" className={inputClass} />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={e => setIsPrimary(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
              />
              <span>Set as primary contact</span>
            </label>

            {isEdit && (
              <div>
                <label htmlFor="ct-status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select id="ct-status" value={status} onChange={e => setStatus(e.target.value)} className={selectClass}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">
                {mutation.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Add contact')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Add/Edit Subscriber Modal ──────────────────────────────────────────────

function SubscriberFormModal({ eventId, subscriber = null, onClose }) {
  const isEdit = !!subscriber;
  const create = useCreateSubscriber();
  const update = useUpdateSubscriber();

  const [firstname, setFirstname] = useState(subscriber?.firstname ?? '');
  const [lastname,  setLastname]  = useState(subscriber?.lastname  ?? '');
  const [timezone,  setTimezone]  = useState(subscriber?.timezone  ?? '');

  // For new subscriber: require at least 1 contact
  const [contact, setContact] = useState({ channel: 'email', value: '', isPrimary: true, label: '' });
  const [error, setError] = useState(null);

  const mutation = isEdit ? update : create;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!firstname.trim()) { setError('First name is required.'); return; }
    if (!lastname.trim())  { setError('Last name is required.'); return; }
    if (!isEdit && !contact.value.trim()) { setError('A contact value is required.'); return; }

    try {
      if (isEdit) {
        const patch = {};
        if (firstname.trim()) patch.firstname = firstname.trim();
        if (lastname.trim())  patch.lastname  = lastname.trim();
        if (timezone.trim())  patch.timezone  = timezone.trim();
        await update.mutateAsync({ eventId, subscriberId: subscriber.id, ...patch });
      } else {
        await create.mutateAsync({
          eventId,
          firstname: firstname.trim(),
          lastname:  lastname.trim(),
          ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
          contacts: [{
            channel:       contact.channel,
            contact_value: contact.value.trim(),
            is_primary:    contact.isPrimary,
            ...(contact.label.trim() ? { label: contact.label.trim() } : {}),
          }],
        });
      }
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to save subscriber.');
    }
  }

  const dialogLabel = isEdit ? 'Edit subscriber' : 'Add subscriber';

  return (
    <div role="dialog" aria-modal="true" aria-label={dialogLabel} className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">{dialogLabel}</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={`${dialogLabel} form`}>
            {error && (
              <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sub-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                  First name <span aria-hidden className="text-red-500">*</span>
                </label>
                <input id="sub-firstname" type="text" value={firstname} onChange={e => setFirstname(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="sub-lastname" className="block text-sm font-medium text-gray-700 mb-1">
                  Last name <span aria-hidden className="text-red-500">*</span>
                </label>
                <input id="sub-lastname" type="text" value={lastname} onChange={e => setLastname(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="sub-timezone" className="block text-sm font-medium text-gray-700 mb-1">
                Timezone <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <input id="sub-timezone" type="text" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="e.g. Europe/London" className={inputClass} />
            </div>

            {!isEdit && (
              <fieldset className="rounded-md border border-gray-200 p-3 space-y-3">
                <legend className="text-sm font-medium text-gray-700 px-1">Contact</legend>

                <div>
                  <label htmlFor="sub-ct-channel" className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                  <select
                    id="sub-ct-channel"
                    value={contact.channel}
                    onChange={e => setContact(c => ({ ...c, channel: e.target.value }))}
                    className={selectClass}
                  >
                    {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                <div>
                  <label htmlFor="sub-ct-value" className="block text-sm font-medium text-gray-700 mb-1">
                    {contact.channel === 'email' ? 'Email address' : 'Phone number'} <span aria-hidden className="text-red-500">*</span>
                  </label>
                  <input
                    id="sub-ct-value"
                    type={contact.channel === 'email' ? 'email' : 'text'}
                    value={contact.value}
                    onChange={e => setContact(c => ({ ...c, value: e.target.value }))}
                    placeholder={contact.channel === 'email' ? 'alice@example.com' : '+15551234567'}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="sub-ct-label" className="block text-sm font-medium text-gray-700 mb-1">Label <span className="text-xs text-gray-400">(optional)</span></label>
                  <input id="sub-ct-label" type="text" value={contact.label} onChange={e => setContact(c => ({ ...c, label: e.target.value }))} placeholder="e.g. work" className={inputClass} />
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contact.isPrimary}
                    onChange={e => setContact(c => ({ ...c, isPrimary: e.target.checked }))}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  Set as primary contact
                </label>
              </fieldset>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">
                {mutation.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Add subscriber')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Contact Row ────────────────────────────────────────────────────────────

function ContactRow({ contact, eventId, subscriberId, canWrite }) {
  const [showEdit,    setShowEdit]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const deleteContact = useDeleteContact();
  const [deleteError, setDeleteError] = useState(null);

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteContact.mutateAsync({ eventId, subscriberId, contactId: contact.id });
      setShowConfirm(false);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      setDeleteError(
        code === 'LAST_CONTACT'
          ? 'Cannot remove the only active contact.'
          : (err?.response?.data?.error?.message ?? err?.message ?? 'Delete failed.')
      );
    }
  }

  const isInactive = contact.status === 'INACTIVE';

  return (
    <>
      <div
        className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs ${isInactive ? 'bg-gray-50 text-gray-400' : 'bg-gray-50 text-gray-700'}`}
        aria-label={`Contact: ${contact.contactValue}`}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-medium uppercase tracking-wide text-gray-400" style={{ fontSize: '10px' }}>{contact.channel}</span>
          <span className="truncate">{contact.contactValue}</span>
          {contact.label && (
            <span className="text-gray-400 italic">{contact.label}</span>
          )}
          {contact.isPrimary && !isInactive && <PrimaryBadge />}
          {isInactive && <span className="text-xs text-gray-400 italic">inactive</span>}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowEdit(true)} className="text-indigo-600 hover:text-indigo-500">Edit</button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              aria-label={`Remove contact ${contact.contactValue}`}
              className="text-red-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {deleteError && <p role="alert" className="text-xs text-red-600 mt-1">{deleteError}</p>}

      {showEdit && (
        <ContactFormModal
          eventId={eventId}
          subscriberId={subscriberId}
          contact={contact}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showConfirm && (
        <div role="dialog" aria-modal="true" aria-label="Confirm remove contact" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowConfirm(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Remove this contact?</h3>
            <p className="text-sm text-gray-600">{contact.contactValue}</p>
            {deleteError && <p role="alert" className="text-sm text-red-600">{deleteError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowConfirm(false)} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">Keep</button>
              <button type="button" onClick={handleDelete} disabled={deleteContact.isPending} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60">
                {deleteContact.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Subscriber Row ─────────────────────────────────────────────────────────

function SubscriberRow({ subscriber, eventId, canWrite }) {
  const [showEdit,        setShowEdit]        = useState(false);
  const [showAddContact,  setShowAddContact]  = useState(false);
  const [showUnsub,       setShowUnsub]       = useState(false);
  const [showRemove,      setShowRemove]      = useState(false);
  const [actionError,     setActionError]     = useState(null);

  const unsubscribe     = useUnsubscribe();
  const deleteSubscriber = useDeleteSubscriber();

  async function handleUnsubscribe() {
    setActionError(null);
    try {
      await unsubscribe.mutateAsync({ eventId, subscriberId: subscriber.id });
      setShowUnsub(false);
    } catch (err) {
      setActionError(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to unsubscribe.');
    }
  }

  async function handleRemove() {
    setActionError(null);
    try {
      await deleteSubscriber.mutateAsync({ eventId, subscriberId: subscriber.id });
      setShowRemove(false);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      setActionError(
        code === 'LAST_SUBSCRIBER'
          ? 'Cannot remove the only active subscriber.'
          : (err?.response?.data?.error?.message ?? err?.message ?? 'Remove failed.')
      );
    }
  }

  const contacts = subscriber.contacts ?? [];

  return (
    <>
      <li
        className="rounded-lg border border-gray-200 px-4 py-3 space-y-3"
        aria-label={`Subscriber: ${subscriber.firstname} ${subscriber.lastname}`}
      >
        {/* Subscriber header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              {subscriber.firstname} {subscriber.lastname}
            </span>
            <SubscriberStatusBadge status={subscriber.status} />
          </div>
          {canWrite && (
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setShowEdit(true)} className="font-medium text-indigo-600 hover:text-indigo-500">Edit</button>
              {subscriber.status === 'ACTIVE' && (
                <button
                  type="button"
                  onClick={() => setShowUnsub(true)}
                  aria-label={`Unsubscribe ${subscriber.firstname} ${subscriber.lastname}`}
                  className="font-medium text-yellow-600 hover:text-yellow-500"
                >
                  Unsubscribe
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowRemove(true)}
                aria-label={`Remove subscriber ${subscriber.firstname} ${subscriber.lastname}`}
                className="font-medium text-red-600 hover:text-red-500"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {subscriber.timezone && (
          <p className="text-xs text-gray-400">{subscriber.timezone}</p>
        )}

        {/* Contacts */}
        <div className="space-y-1.5">
          {contacts.length === 0 && (
            <p className="text-xs text-gray-400 italic">No contacts.</p>
          )}
          {contacts.map(c => (
            <ContactRow
              key={c.id}
              contact={c}
              eventId={eventId}
              subscriberId={subscriber.id}
              canWrite={canWrite}
            />
          ))}
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowAddContact(true)}
              className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              + Add contact
            </button>
          )}
        </div>

        {actionError && <p role="alert" className="text-xs text-red-600">{actionError}</p>}
      </li>

      {showEdit && (
        <SubscriberFormModal eventId={eventId} subscriber={subscriber} onClose={() => setShowEdit(false)} />
      )}

      {showAddContact && (
        <ContactFormModal eventId={eventId} subscriberId={subscriber.id} onClose={() => setShowAddContact(false)} />
      )}

      {/* Unsubscribe confirmation */}
      {showUnsub && (
        <div role="dialog" aria-modal="true" aria-label="Confirm unsubscribe" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowUnsub(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Unsubscribe {subscriber.firstname}?</h3>
            <p className="text-sm text-gray-600">They will no longer receive reminders for this event.</p>
            {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowUnsub(false)} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">Keep</button>
              <button type="button" onClick={handleUnsubscribe} disabled={unsubscribe.isPending} className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-yellow-400 disabled:opacity-60">
                {unsubscribe.isPending ? 'Unsubscribing…' : 'Unsubscribe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove confirmation */}
      {showRemove && (
        <div role="dialog" aria-modal="true" aria-label="Confirm remove subscriber" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowRemove(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Remove {subscriber.firstname} {subscriber.lastname}?</h3>
            <p className="text-sm text-gray-600">This subscriber will be permanently removed from this event.</p>
            {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowRemove(false)} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">Keep</button>
              <button type="button" onClick={handleRemove} disabled={deleteSubscriber.isPending} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60">
                {deleteSubscriber.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Subscribers Tab ────────────────────────────────────────────────────────

/**
 * Props:
 *  eventId  – string
 *  canWrite – boolean (OWNER or CONTRIBUTOR + event ACTIVE)
 */
export default function SubscribersTab({ eventId, canWrite }) {
  const { data: subscribers = [], isLoading, isError, error } = useListSubscribers(eventId);
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) {
    return <p className="text-sm text-gray-500 py-4">Loading subscribers…</p>;
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
        {error?.response?.data?.error?.message ?? error?.message ?? 'Failed to load subscribers.'}
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Subscribers">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Subscribers{subscribers.length > 0 ? ` (${subscribers.length})` : ''}
        </h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            + Add subscriber
          </button>
        )}
      </div>

      {/* List */}
      {subscribers.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">No subscribers yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Subscribers list">
          {subscribers.map(s => (
            <SubscriberRow
              key={s.id}
              subscriber={s}
              eventId={eventId}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      {showAdd && (
        <SubscriberFormModal eventId={eventId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
