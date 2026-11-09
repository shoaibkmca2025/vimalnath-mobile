import type { Icon } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

import { cx } from '@/lib/cx';

type Variant = 'primary' | 'secondary' | 'plain' | 'danger' | 'danger-plain';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: Icon;
  /** Shows a spinner, disables the button and swaps in `loadingLabel` while an action runs. */
  loading?: boolean;
  loadingLabel?: string;
  block?: boolean;
};

const classes = (variant: Variant, size: Size, block?: boolean, className?: string) =>
  cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className);

export function Button({ variant = 'secondary', size = 'md', icon: IconComponent, loading = false, loadingLabel, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : IconComponent && <IconComponent size={size === 'sm' ? 15 : 17} weight="bold" aria-hidden />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

export function ButtonLink({ variant = 'secondary', size = 'md', icon: IconComponent, block, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: Icon; block?: boolean; children: ReactNode }) {
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      {IconComponent && <IconComponent size={size === 'sm' ? 15 : 17} weight="bold" aria-hidden />}
      {children}
    </Link>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: Icon;
  /** Required: icon-only buttons need a spoken name. Also shown as a tooltip. */
  label: string;
  tone?: 'default' | 'danger';
  size?: number;
};

export function IconButton({ icon: IconComponent, label, tone = 'default', size = 18, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('icon-btn', tone === 'danger' && 'icon-btn--danger', className)} aria-label={label} title={label} {...rest}>
      <IconComponent size={size} aria-hidden />
    </button>
  );
}
