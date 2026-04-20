import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getStoredUserId } from '../hooks/useAuth.js';
import { useGetProfile, useUpdateProfile, useChangePassword } from '../hooks/useProfile.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  firstname: z.string().min(1, 'First name is required'),
  lastname:  z.string().min(1, 'Last name is required'),
  email:     z.string().email('Enter a valid email address'),
  phone:     z.string().optional(),
  timezone:  z.string().min(1, 'Timezone is required'),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine(d => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// ── Shared field component ────────────────────────────────────────────────────

function Field({ id, label, type = 'text', autoComplete, registration, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {label}
      </label>
      <div className="mt-2">
        {children ?? (
          <input
            id={id}
            type={type}
            autoComplete={autoComplete}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? 'true' : undefined}
            className={[
              'block w-full rounded-md px-3 py-1.5 text-base text-gray-900',
              'outline outline-1 -outline-offset-1',
              'placeholder:text-gray-400 sm:text-sm',
              'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
              error ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
            ].join(' ')}
            {...registration}
          />
        )}
        {error && (
          <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Timezone list (uses browser Intl API) ─────────────────────────────────────

const TIMEZONES =
  typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
       'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
       'Australia/Sydney', 'Pacific/Auckland'];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const navigate  = useNavigate();
  const userId    = getStoredUserId();

  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const profile = useGetProfile(userId);

  // ── Profile form ────────────────────────────────────────────────────────
  const updateProfile  = useUpdateProfile(userId);
  const [profileOk, setProfileOk] = useState(false);

  const {
    register:     registerProfile,
    handleSubmit: handleProfile,
    reset:        resetProfile,
    formState:    { errors: pe, isSubmitting: pSubmitting },
  } = useForm({ resolver: zodResolver(profileSchema) });

  useEffect(() => {
    if (profile.data) {
      resetProfile({
        firstname: profile.data.firstname ?? '',
        lastname:  profile.data.lastname  ?? '',
        email:     profile.data.email     ?? '',
        phone:     profile.data.phone     ?? '',
        timezone:  profile.data.timezone  ?? 'UTC',
      });
    }
  }, [profile.data, resetProfile]);

  async function onSubmitProfile(values) {
    try {
      setProfileOk(false);
      await updateProfile.mutateAsync(values);
      setProfileOk(true);
    } catch { /* error rendered from updateProfile.error */ }
  }

  const profileApiError = updateProfile.error?.response?.data?.error?.message
    ?? updateProfile.error?.message
    ?? null;

  // ── Change password form ─────────────────────────────────────────────────
  const changePassword = useChangePassword(userId);
  const [passwordOk, setPasswordOk] = useState(false);

  const {
    register:     registerPw,
    handleSubmit: handlePw,
    reset:        resetPw,
    formState:    { errors: we, isSubmitting: wSubmitting },
  } = useForm({ resolver: zodResolver(passwordSchema) });

  async function onSubmitPassword(values) {
    try {
      setPasswordOk(false);
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword:     values.newPassword,
      });
      setPasswordOk(true);
      resetPw();
    } catch { /* error rendered from changePassword.error */ }
  }

  const passwordApiError = changePassword.error?.response?.data?.error?.message
    ?? changePassword.error?.message
    ?? null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-12 sm:px-6 lg:px-8">
      {/* Logo + title */}
      <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
              <span className="text-sm font-bold text-white select-none">RMS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Your Profile</h1>
          </div>
          <Link
            to="/events"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            ← Back to events
          </Link>
        </div>

        {/* Loading skeleton */}
        {profile.isLoading && (
          <div className="bg-white px-6 py-12 shadow sm:rounded-lg text-center text-sm text-gray-500">
            Loading profile…
          </div>
        )}

        {/* Loaded */}
        {!profile.isLoading && (
          <div className="bg-white px-6 py-10 shadow sm:rounded-lg sm:px-12 space-y-10">

            {/* ── Section 1: Profile information ── */}
            <section aria-labelledby="profile-heading">
              <h2 id="profile-heading" className="text-base font-semibold text-gray-900 mb-6">
                Profile information
              </h2>

              <form onSubmit={handleProfile(onSubmitProfile)} noValidate className="space-y-5">
                {profileOk && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200"
                  >
                    Profile updated successfully.
                  </div>
                )}
                {profileApiError && (
                  <div
                    role="alert"
                    className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
                  >
                    {profileApiError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field id="firstname" label="First name" autoComplete="given-name"
                    registration={registerProfile('firstname')} error={pe.firstname} />
                  <Field id="lastname" label="Last name" autoComplete="family-name"
                    registration={registerProfile('lastname')} error={pe.lastname} />
                </div>

                <Field id="email" label="Email address" type="email" autoComplete="email"
                  registration={registerProfile('email')} error={pe.email} />

                <Field id="phone" label="Phone number (optional)" type="tel" autoComplete="tel"
                  registration={registerProfile('phone')} error={pe.phone} />

                <Field id="timezone" label="Timezone" error={pe.timezone}>
                  <select
                    id="timezone"
                    aria-describedby={pe.timezone ? 'timezone-error' : undefined}
                    aria-invalid={pe.timezone ? 'true' : undefined}
                    className={[
                      'block w-full rounded-md px-3 py-1.5 text-base text-gray-900',
                      'outline outline-1 -outline-offset-1',
                      'placeholder:text-gray-400 sm:text-sm',
                      'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
                      pe.timezone ? 'outline-red-400 bg-red-50' : 'outline-gray-300 bg-white',
                    ].join(' ')}
                    {...registerProfile('timezone')}
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </Field>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={pSubmitting}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                               hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2
                               focus-visible:outline-offset-2 focus-visible:outline-indigo-600
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pSubmitting ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </section>

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* ── Section 2: Change password ── */}
            <section aria-labelledby="password-heading">
              <h2 id="password-heading" className="text-base font-semibold text-gray-900 mb-6">
                Change password
              </h2>

              <form onSubmit={handlePw(onSubmitPassword)} noValidate className="space-y-5">
                {passwordOk && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200"
                  >
                    Password changed successfully.
                  </div>
                )}
                {passwordApiError && (
                  <div
                    role="alert"
                    className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
                  >
                    {passwordApiError}
                  </div>
                )}

                <Field id="currentPassword" label="Current password" type="password"
                  autoComplete="current-password"
                  registration={registerPw('currentPassword')} error={we.currentPassword} />

                <Field id="newPassword" label="New password" type="password"
                  autoComplete="new-password"
                  registration={registerPw('newPassword')} error={we.newPassword} />

                <Field id="confirmPassword" label="Confirm new password" type="password"
                  autoComplete="new-password"
                  registration={registerPw('confirmPassword')} error={we.confirmPassword} />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={wSubmitting}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm
                               hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2
                               focus-visible:outline-offset-2 focus-visible:outline-indigo-600
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {wSubmitting ? 'Updating…' : 'Change password'}
                  </button>
                </div>
              </form>
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
