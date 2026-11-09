import { ImageSquareIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { MAX_IMAGE_KB, readImageFile } from '@/lib/image';

type Props = {
  label: string;
  value: string | null;
  onChange: (image: string | null) => void;
  /** 'square' for product photos on white, 'wide' for banners and room photos. */
  shape?: 'square' | 'wide';
  allowRemove?: boolean;
  hint?: string;
};

/** Current photo with Replace and Remove; errors appear right under it. */
export function ImagePicker({ label, value, onChange, shape = 'square', allowRemove = true, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange(await readImageFile(file));
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That photo couldn’t be used.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      {value ? (
        <img
          className="image-preview"
          src={value}
          alt={`Current ${label.toLowerCase()}`}
          style={shape === 'wide' ? { aspectRatio: '16 / 9', objectFit: 'cover' } : undefined}
        />
      ) : (
        <div className="image-preview thumb--empty" style={{ display: 'grid', placeItems: 'center', ...(shape === 'wide' ? { aspectRatio: '16 / 9' } : {}) }}>
          <span className="stack" style={{ alignItems: 'center', gap: 'var(--space-1)', color: 'var(--text-2)' }}>
            <ImageSquareIcon size={28} aria-hidden />
            No photo yet
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <div className="row-wrap">
        <Button size="sm" icon={UploadSimpleIcon} onClick={() => inputRef.current?.click()} aria-describedby={`${id}-label ${id}-hint`}>
          {value ? 'Replace Photo' : 'Add Photo'}
        </Button>
        {value && allowRemove && (
          <Button size="sm" variant="danger-plain" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : (
        <p className="field__hint" id={`${id}-hint`}>
          {hint ?? `JPG, PNG or WebP, up to ${MAX_IMAGE_KB} KB.`}
        </p>
      )}
    </div>
  );
}
