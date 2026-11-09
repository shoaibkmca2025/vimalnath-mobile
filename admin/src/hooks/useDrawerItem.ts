import { useCallback, useState } from 'react';

/**
 * Which item an editing drawer shows. The item stays set while the drawer slides out, so its content
 * doesn't blank mid-animation; `open` alone controls visibility.
 */
export function useDrawerItem<T>() {
  const [item, setItem] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((next: T) => {
    setItem(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { item, open, show, close };
}
