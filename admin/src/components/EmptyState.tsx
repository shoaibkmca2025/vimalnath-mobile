import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Explains why a view is empty and what to do next. */
export function EmptyState({ icon: IconComponent, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        <IconComponent size={24} />
      </div>
      <p className="empty__title">{title}</p>
      {children && <p className="empty__body">{children}</p>}
      {action}
    </div>
  );
}
