import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Sparkline } from '@/components/Charts';

type Props = {
  label: string;
  icon: Icon;
  value: string;
  /** Full value for the tooltip when `value` is compacted, e.g. ₹12,45,300 for ₹12.5L. */
  title?: string;
  /** Percentage change against the previous period; null when there's nothing to compare. */
  delta?: number | null;
  /** Names the comparison, e.g. "vs previous 30 days". */
  deltaLabel?: string;
  /** Whether a rise is good news (orders) or bad news (orders waiting). */
  upIsGood?: boolean;
  trend?: number[];
  foot?: ReactNode;
  to?: string;
};

/** Label, value, signed change against a named period, and a small trend. */
export function Stat({ label, icon: IconComponent, value, title, delta, deltaLabel, upIsGood = true, trend, foot, to }: Props) {
  const flat = delta !== undefined && delta !== null && Math.abs(delta) < 0.5;
  const tone = delta === undefined || delta === null || flat ? 'neutral' : delta > 0 === upIsGood ? 'good' : 'bad';
  const DeltaIcon = flat ? ArrowRightIcon : delta && delta > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;

  const body = (
    <>
      <p className="stat__label">
        <IconComponent size={16} aria-hidden /> {label}
      </p>
      <div className="stat__row">
        <p className="stat__value" title={title}>
          {value}
        </p>
        {trend && <Sparkline values={trend} />}
      </div>
      {delta !== undefined && (
        <p className="stat__delta" data-tone={tone}>
          {delta === null ? (
            <span className="muted">No earlier orders to compare</span>
          ) : (
            <>
              <span className="stat__change">
                <DeltaIcon size={13} weight="bold" aria-hidden />
                <span className="visually-hidden">{flat ? 'No change' : delta > 0 ? 'Up' : 'Down'}</span>
                {flat ? '0%' : `${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`}
              </span>{' '}
              <span className="muted">{deltaLabel}</span>
            </>
          )}
        </p>
      )}
      {foot && <p className="stat__foot">{foot}</p>}
    </>
  );

  return to ? (
    <Link to={to} className="card stat stat--link">
      {body}
    </Link>
  ) : (
    <div className="card stat">{body}</div>
  );
}
