import { XIcon } from '@phosphor-icons/react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { useModal, usePresence } from '@/hooks/useModal';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** With unsaved edits, closing asks before throwing them away. */
  dirty?: boolean;
  onClose: () => void;
  /** Turns the body into a form so Enter saves; the footer's submit button triggers it. */
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
};

/** Side sheet for editing one item without leaving the list. Slides in from, and back out to, the right. */
export function Drawer({ open, title, description, dirty = false, onClose, onSubmit, footer, children }: Props) {
  const { mounted, state } = usePresence(open);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  const requestClose = () => (dirty ? setConfirming(true) : onClose());
  useModal(ref, open && !confirming, requestClose);
  if (!mounted) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  const content = (
    <>
      <div className="drawer__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="drawer__title" id={`${id}-t`}>
            {title}
          </h2>
          {description && <p className="drawer__description">{description}</p>}
        </div>
        <IconButton icon={XIcon} label="Close" onClick={requestClose} />
      </div>
      <div className="drawer__body">{children}</div>
      {footer && <div className="drawer__footer">{footer}</div>}
    </>
  );

  return createPortal(
    <>
      <div className="overlay-scrim" data-state={state} onClick={requestClose} aria-hidden />
      <div ref={ref} className="drawer" data-state={state} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}>
        {onSubmit ? (
          <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
            {content}
          </form>
        ) : (
          content
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Discard your changes?"
        body="The edits you made here haven’t been saved."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onClose();
        }}
      />
    </>,
    document.body,
  );
}
