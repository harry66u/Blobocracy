// The mute setting, remembered across visits. Storage can be missing or throw
// (private mode, blocked site data), so every access is guarded.
export const MUTED_KEY = 'blob.muted';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadMuted(storage: StorageLike | null | undefined): boolean {
  try {
    return storage?.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(storage: StorageLike | null | undefined, muted: boolean): void {
  try {
    storage?.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Not remembered this time; the setting still applies for this visit.
  }
}
