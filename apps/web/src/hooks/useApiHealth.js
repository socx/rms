import { useState, useEffect } from 'react';

function formatTimestamp(date) {
  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh   = String(date.getHours()).padStart(2, '0');
  const min  = String(date.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

export function useApiHealth() {
  const [status, setStatus] = useState(null); // null = not yet checked

  useEffect(() => {
    let cancelled = false;

    fetch('/health', { method: 'GET' })
      .then(res => {
        if (!cancelled) {
          setStatus(res.ok ? { ok: true, checkedAt: formatTimestamp(new Date()) } : { ok: false });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ ok: false });
      });

    return () => { cancelled = true; };
  }, []);

  return status;
}
