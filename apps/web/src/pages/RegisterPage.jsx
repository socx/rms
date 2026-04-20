import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useRegister } from '../hooks/useAuth.js';

const schema = z
  .object({
    firstname: z.string().min(1, 'First name is required'),
    lastname: z.string().min(1, 'Last name is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

function Field({ id, label, type = 'text', autoComplete, registration, error }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {label}
      </label>
      <div className="mt-2">
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
        {error && (
          <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const register = useRegister();

  const {
    register: field,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  async function onSubmit(values) {
    try {
      await register.mutateAsync(values);
    } catch {
      // error displayed via register.error below
    }
  }

  const apiError = register.error?.response?.data?.error?.message
    ?? register.error?.message
    ?? null;

  // Success state: show confirmation and link back to login
  if (register.isSuccess) {
    return (
      <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
            <span className="text-sm font-bold text-white select-none">RMS</span>
          </div>
        </div>
        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
          <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12 text-center">
            <div
              role="status"
              aria-live="polite"
              className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200 mb-6"
            >
              Account created! Check your inbox to verify your email address. It may take a few minutes to arrive.
              Please, be sure to check your spam folder if you don&apos;t see it.
            </div>
            <p className="text-sm text-gray-600">
              Already verified?{' '}
              <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50">
      {/* Logo + heading */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
          <span className="text-sm font-bold text-white select-none">RMS</span>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-gray-900">
          Create your account
        </h2>
      </div>

      {/* Card */}
      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12">
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

            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <Field
                id="firstname"
                label="First name"
                autoComplete="given-name"
                registration={field('firstname')}
                error={errors.firstname}
              />
              <Field
                id="lastname"
                label="Last name"
                autoComplete="family-name"
                registration={field('lastname')}
                error={errors.lastname}
              />
            </div>

            <Field
              id="email"
              label="Email address"
              type="email"
              autoComplete="email"
              registration={field('email')}
              error={errors.email}
            />

            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              registration={field('password')}
              error={errors.password}
            />

            <Field
              id="confirmPassword"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              registration={field('confirmPassword')}
              error={errors.confirmPassword}
            />

            {/* Submit */}
            <div>
              <button
                type="submit"
                disabled={isSubmitting || register.isPending}
                className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {register.isPending ? 'Creating account…' : 'Create account'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
