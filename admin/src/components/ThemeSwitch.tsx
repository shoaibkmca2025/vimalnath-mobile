import { MonitorIcon, MoonIcon, SunIcon, type Icon } from '@phosphor-icons/react';

import { useTheme, type ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: Icon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'Match system', icon: MonitorIcon },
];

/**
 * Light, Dark or Match System, always in the top bar so it's one click away on every page (the same choice as
 * Settings › Appearance). Arrow keys move between the three, like any radio group.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const move = (direction: 1 | -1) => {
    const index = OPTIONS.findIndex((option) => option.value === theme);
    const next = OPTIONS[(index + direction + OPTIONS.length) % OPTIONS.length]!;
    setTheme(next.value);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.theme-switch [data-theme-option="${next.value}"]`)?.focus());
  };
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, icon: OptionIcon }) => {
        const checked = value === theme;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            data-theme-option={value}
            className="theme-switch__option"
            onClick={() => setTheme(value)}
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
            <OptionIcon size={16} weight={checked ? 'fill' : 'regular'} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
