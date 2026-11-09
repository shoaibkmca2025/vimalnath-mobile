import { useEffect, useRef, useState, type RefObject } from 'react';

const EXIT_MS = 200;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps an overlay mounted while its exit animation plays. */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);

  // Opening mounts right away, during render; closing unmounts after the exit animation.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  return { mounted, state: !open && mounted ? ('closing' as const) : ('open' as const) };
}

/**
 * Modal behaviour for drawers and dialogs: focus moves inside and is trapped there, Escape closes,
 * the page behind doesn't scroll, and focus returns to whatever opened the overlay.
 */
export function useModal(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const autofocus = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (autofocus ?? node)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener('keydown', onKeyDown);

    return () => {
      node?.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [active, ref]);
}
