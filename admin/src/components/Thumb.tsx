import { ImageSquareIcon } from '@phosphor-icons/react';

import { cx } from '@/lib/cx';
import { sized } from '@/lib/upload';

/** Product or category image at a fixed size, with a placeholder when there's no photo yet. */
export function Thumb({ src, size = 'md', fit = 'contain' }: { src: string | null | undefined; size?: 'md' | 'lg'; fit?: 'contain' | 'cover' }) {
  const dimension = size === 'lg' ? 72 : 44;
  if (!src)
    return (
      <span className={cx('thumb thumb--empty', size === 'lg' && 'thumb--lg')} aria-hidden>
        <ImageSquareIcon size={size === 'lg' ? 24 : 18} />
      </span>
    );
  return <img className={cx('thumb', size === 'lg' && 'thumb--lg', fit === 'cover' && 'thumb--cover')} src={sized(src, 'sm')} alt="" width={dimension} height={dimension} loading="lazy" decoding="async" />;
}
