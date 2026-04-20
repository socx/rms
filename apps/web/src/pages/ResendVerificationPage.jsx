import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useResendVerification } from '../hooks/useAuth.js';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
});

export default function ResendVerificationPage() {
  const resend = useResendVerification();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  async function onSubmit(values) {
    try {
      await resend.mutateAsync(values);
    } catch {
      // error shown via resend.error
    }
  }

  const apiError = resend.error?.response?.data?.error?.message
    ?? resend.error?.message
    ?? null;

  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50">
      {/* Logo + heading */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
          <span className="text-sm font-bold text-white select-none">RMS</span>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-gray-900">
          Resend verification email
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Enter your email address and we&apos;ll send you a new verification link.
        </p>
      </div>

      {/* Card */}
      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12">
          {/* Success banner — form stays so user can re-submit if needed */}
          {resend.isSuccess && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200 mb-6"
            >
              If an unverified account exists for that address, a new verification
              email has been sent. Please check your inbox.
              Please, be sure to check your spam folder if you don&apos;t see it.
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* API error banner */}
            {apiError && (
              <div
                role="alert"
                className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
              >
                {apiError}
              </div>
            )}

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-900"
              >
                Email address
              </label>
              <div className="mt-2">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  aria-invalid={errors.email ? 'true' : undefined}
                  className={[
                    'block w-full rounded-md px-3 py-1.5 text-base text-gray-900',
                    'outline outline-1 -outline-offset-1',
                    'placeholder:text-gray-400 sm:text-sm',
                    'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
                    errors.email
                      ? 'outline-red-400 bg-red-50'
                      : 'outline-gray-300 bg-white',
                  ].join(' ')}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="email-error" className="mt-1 text-xs text-red-600">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            {/* Submit */}
            <div>
              <button
                type="submit"
                disabled={resend.isPending}
                className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resend.isPending ? 'Sending…' : 'Send verification email'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Remembered your password?{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
