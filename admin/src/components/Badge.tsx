import { CheckCircleIcon, CheckIcon, ClockIcon, TruckIcon, XCircleIcon, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { ORDER_STATUS, type Tone } from '@/data/orders';
import type { OrderStatus } from '@/data/types';

/** Status pill. Tone is never the only signal: every badge carries text, most an icon too. */
export function Badge({ tone, icon: IconComponent, children }: { tone: Tone; icon?: Icon; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {IconComponent && <IconComponent size={12} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_ICONS: Record<OrderStatus, Icon> = {
  placed: ClockIcon,
  confirmed: CheckIcon,
  dispatched: TruckIcon,
  delivered: CheckCircleIcon,
  cancelled: XCircleIcon,
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS[status];
  return (
    <Badge tone={meta.tone} icon={STATUS_ICONS[status]}>
      {meta.label}
    </Badge>
  );
}
