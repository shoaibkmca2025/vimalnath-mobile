import { createContext, useContext } from 'react';

import type { Activity, Database } from './types';

/** What an edit adds to the activity log; the time and the admin's name are filled in. */
export type LogEntry = Pick<Activity, 'area' | 'summary' | 'to'>;

export type DataContextValue = {
  db: Database;
  /** Changes one part of the data. Pass `log` to record the change in the activity log. */
  update: <K extends keyof Database>(key: K, change: (current: Database[K]) => Database[K], log?: LogEntry) => void;
  /** Drops every local edit and goes back to the app's data. */
  reset: () => void;
  hasChanges: boolean;
};

export const DataContext = createContext<DataContextValue | null>(null);

/** The admin's data and the one way to change it. See DataProvider in store.tsx. */
export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside DataProvider');
  return context;
}
