import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/** Sent by the Feedback page after a change, so the sidebar's count catches up straight away. */
export const FEEDBACK_CHANGED = 'vimalnath:feedback-changed';

/**
 * Feedback not looked at yet, for the sidebar's red count: fetched now, every minute, when the window comes back to the
 * front, and after a change on the Feedback page. A server from before feedback simply leaves it at 0.
 */
export function useNewFeedback(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      api<{ new: number }>('/feedback/count').then(
        (result) => active && setCount(result.new),
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener(FEEDBACK_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(FEEDBACK_CHANGED, load);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
