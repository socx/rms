import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '../hooks/useAuth.js';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  async function onSubmit(values) {
    try {
      await login.mutateAsync(values);
      navigate('/events');
    } catch {
      // error displayed via login.error below
    }
  }

  const apiError = login.error?.response?.data?.error?.message
    ?? login.error?.message
    ?? null;

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50 min-h-screen">
      {/* Logo + heading */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
          <span className="text-sm font-bold text-white select-none">RMS</span>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-gray-900">
          Sign in to your account
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

            {/* Password */}
            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-900"
                >
                  Password
                </label>
                <div className="text-sm">
                  <a
                    href="#"
                    className="font-semibold text-indigo-600 hover:text-indigo-500"
                  >
                    Forgot password?
                  </a>
                </div>
              </div>
              <div className="mt-2">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  aria-invalid={errors.password ? 'true' : undefined}
                  className={[
                    'block w-full rounded-md px-3 py-1.5 text-base text-gray-900',
                    'outline outline-1 -outline-offset-1',
                    'placeholder:text-gray-400 sm:text-sm',
                    'focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600',
                    errors.password
                      ? 'outline-red-400 bg-red-50'
                      : 'outline-gray-300 bg-white',
                  ].join(' ')}
                  {...register('password')}
                />
                {errors.password && (
                  <p id="password-error" className="mt-1 text-xs text-red-600">
                    {errors.password.message}
                  </p>
                )}
              </div>
            </div>

            {/* Submit */}
            <div>
              <button
                type="submit"
                disabled={isSubmitting || login.isPending}
                className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-500">
          Create one
        </Link>
      </p>
    </div>
  );
}
