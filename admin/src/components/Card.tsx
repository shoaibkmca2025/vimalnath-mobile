import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('card', className)} {...rest} />;
}

/** Card title row. `id` lets the card use aria-labelledby. */
export function CardHeader({ title, description, action, id }: { title: string; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className="card__header">
      <div style={{ minWidth: 0 }}>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
