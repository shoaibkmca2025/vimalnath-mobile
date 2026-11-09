import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/Button';
import { useModal, usePresence } from '@/hooks/useModal';

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** Destructive confirmations get the red button; Cancel stays the default focus. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmation for actions that can't be undone. Use sparingly so people still read it. */
export function ConfirmDialog({ open, title, body, confirmLabel, destructive = false, onConfirm, onCancel }: Props) {
  const { mounted, state } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(ref, open, onCancel);
  if (!mounted) return null;

  return createPortal(
    <>
      <div className="overlay-scrim" data-state={state} style={{ zIndex: 'var(--z-dialog)' }} onClick={onCancel} aria-hidden />
      <div className="dialog-layer">
        <div ref={ref} className="dialog" data-state={state} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} tabIndex={-1}>
          <h2 className="dialog__title" id={`${id}-t`}>
            {title}
          </h2>
          <p className="dialog__body" id={`${id}-b`}>
            {body}
          </p>
          <div className="dialog__actions">
            <Button onClick={onCancel} data-autofocus>
              Cancel
            </Button>
            <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
