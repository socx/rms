import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useVerifyEmail } from '../hooks/useAuth.js';

function Card({ children }) {
  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
          <span className="text-sm font-bold text-white select-none">RMS</span>
        </div>
      </div>
      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12 text-center">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const verify = useVerifyEmail();

  useEffect(() => {
    if (token) {
      verify.mutate(token);
    }
    // Run once on mount; eslint-disable-next-line is intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── No token in URL ──────────────────────────────────────────────────────
  if (!token) {
    return (
      <Card>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Invalid link</h2>
        <p className="text-sm text-gray-600 mb-6">
          This verification link is missing a token. Please use the link from
          your email, or request a new one.
        </p>
        <Link
          to="/resend-verification"
          className="font-semibold text-indigo-600 hover:text-indigo-500 text-sm"
        >
          Resend verification email
        </Link>
      </Card>
    );
  }

  // ── Pending ───────────────────────────────────────────────────────────────
  if (verify.isPending || verify.isIdle) {
    return (
      <Card>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-gray-600"
        >
          Verifying your email…
        </p>
      </Card>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (verify.isSuccess) {
    return (
      <Card>
        <div
          role="status"
          aria-live="polite"
          className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200 mb-6"
        >
          Your email has been verified. You can now sign in.
        </div>
        <Link
          to="/login"
          className="font-semibold text-indigo-600 hover:text-indigo-500 text-sm"
        >
          Sign in
        </Link>
      </Card>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  const errorCode = verify.error?.response?.data?.error?.code ?? '';
  const isExpired = errorCode === 'TOKEN_EXPIRED';
  const isUsed    = errorCode === 'TOKEN_USED';
  const errorMsg  = verify.error?.response?.data?.error?.message
    ?? verify.error?.message
    ?? 'Something went wrong. Please try again.';

  return (
    <Card>
      <div
        role="alert"
        className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200 mb-6"
      >
        {errorMsg}
      </div>

      {(isExpired || isUsed) ? (
        <p className="text-sm text-gray-600">
          Need a new link?{' '}
          <Link
            to="/resend-verification"
            className="font-semibold text-indigo-600 hover:text-indigo-500"
          >
            Resend verification email
          </Link>
        </p>
      ) : (
        <Link
          to="/login"
          className="font-semibold text-indigo-600 hover:text-indigo-500 text-sm"
        >
          Back to sign in
        </Link>
      )}
    </Card>
  );
}
