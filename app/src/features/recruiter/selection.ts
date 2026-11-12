import { useSyncExternalStore } from 'react';

/** The drive the Candidates and Messages tabs are showing. Kept in memory only; reset on sign-out via reset(). */
let selected: string | null = null;
const listeners = new Set<() => void>();

export const driveSelection = {
  get: () => selected,
  set(id: string | null) {
    if (id === selected) return;
    selected = id;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export function useSelectedDriveId(): string | null {
  return useSyncExternalStore(driveSelection.subscribe, driveSelection.get, driveSelection.get);
}
