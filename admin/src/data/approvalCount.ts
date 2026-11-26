import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/** Fired after a discount is approved or refused, so the sidebar's count catches up at once. */
export const APPROVALS_CHANGED = 'vimalnath:approvals-changed';

/** Discounts waiting for approval, for the sidebar: fetched now, every minute, when the window comes back, and after a decision. */
export function useApprovalCount(enabled: boolean) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      api<{ pending: number }>('/discounts/approvals/count').then(
        (result) => active && setPending(result.pending),
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener(APPROVALS_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(APPROVALS_CHANGED, load);
    };
  }, [enabled]);
  return enabled ? pending : 0;
}
