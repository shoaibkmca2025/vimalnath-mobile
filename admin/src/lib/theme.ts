import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

// v2: light became the default to match the mobile app, so earlier saved choices start over.
const KEY = 'vimalnath-admin:theme:v2';
const listeners = new Set<() => void>();

/** Light unless someone picked Dark or Match System in Settings. */
export function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dark' || saved === 'system' ? saved : 'light';
  } catch {
    return 'light';
  }
}

let current: ThemePreference = readTheme();

/** "system" removes the attribute so the prefers-color-scheme rules in tokens.css apply. */
export function applyTheme(theme: ThemePreference) {
  current = theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

/** The theme preference, shared by everything that shows or changes it. */
export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  const theme = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return [theme, applyTheme];
}
