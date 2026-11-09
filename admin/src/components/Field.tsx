import { EyeIcon, EyeSlashIcon, MagnifyingGlassIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { IconButton } from '@/components/Button';
import { cx } from '@/lib/cx';

type FieldChrome = {
  label: string;
  hint?: ReactNode;
  /** Shown under the control and announced with it. */
  error?: string | null;
  required?: boolean;
  className?: string;
};

/** Label, control, hint and error, wired together for screen readers. */
function Field({ label, hint, error, required, className, id, children }: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className={cx('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          <WarningCircleIcon size={14} weight="fill" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error?: string | null) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type TextFieldProps = FieldChrome &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'prefix'> & { prefix?: string; suffix?: string; ref?: Ref<HTMLInputElement> };

export function TextField({ label, hint, error, required, className, prefix, suffix, id: givenId, ref, ...input }: TextFieldProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const control = (
    <input
      ref={ref}
      id={id}
      className={cx('input', prefix && 'input--prefixed', suffix && 'input--suffixed')}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      aria-required={required || undefined}
      {...input}
    />
  );
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} id={id}>
      {prefix || suffix ? (
        <div className="input-affix">
          {prefix && (
            <span className="input-affix__prefix" aria-hidden>
              {prefix}
            </span>
          )}
          {control}
          {suffix && (
            <span className="input-affix__suffix" aria-hidden>
              {suffix}
            </span>
          )}
        </div>
      ) : (
        control
      )}
    </Field>
  );
}

/** A password input with a show/hide button. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'prefix' | 'suffix'>) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <TextField {...props} type={shown ? 'text' : 'password'} style={{ paddingRight: 44 }} />
      <IconButton
        icon={shown ? EyeSlashIcon : EyeIcon}
        label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((current) => !current)}
        style={{ position: 'absolute', right: 2, top: 26 }}
      />
    </div>
  );
}

export function TextAreaField({ label, hint, error, required, className, id: givenId, ...textarea }: FieldChrome & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} id={id}>
      <textarea id={id} className="textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...textarea} />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  options,
  id: givenId,
  ...select
}: FieldChrome & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { options: { value: string; label: string }[] }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} id={id}>
      <select id={id} className="select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** On/off control. The visible label is part of the hit area. */
export function Switch({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-describedby={description ? `${id}-d` : undefined} />
      <span className="switch__track" aria-hidden />
      <span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {description && (
          <span id={`${id}-d`} className="field__hint" style={{ display: 'block' }}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

/** Single choice among a few options, as a radio group with arrow-key support. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const move = (direction: 1 | -1) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + direction + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => (document.querySelector(`[data-segment="${CSS.escape(next.value)}"][data-group="${CSS.escape(label)}"]`) as HTMLElement | null)?.focus());
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-segment={option.value}
            data-group={label}
            className="segmented__item"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {option.label}
            {option.count !== undefined && <span className="segmented__count num">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="search" role="search">
      <MagnifyingGlassIcon size={16} aria-hidden />
      <input
        type="search"
        className="input"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
