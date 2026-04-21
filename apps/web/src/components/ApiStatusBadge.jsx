import React from 'react';
import { useApiHealth } from '../hooks/useApiHealth.js';

export default function ApiStatusBadge() {
  const status = useApiHealth();

  if (status === null) return null; // hide until first check completes

  return (
    <div
      aria-live="polite"
      aria-label="API status"
      className={[
        'fixed top-3 right-4 z-50 rounded-full px-3 py-1 text-xs font-medium shadow-sm select-none',
        status.ok
          ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
          : 'bg-red-50 text-red-700 ring-1 ring-red-200',
      ].join(' ')}
    >
      {status.ok
        ? `API Status @ ${status.checkedAt}: Ok`
        : 'API Status: Unavailable'}
    </div>
  );
}
