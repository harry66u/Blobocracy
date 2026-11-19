// The player's chosen name, kept in this browser. Storage can be blocked (private windows),
// so every access is guarded and the game works without it.
const NAME_KEY = 'blobocracy.name';
const ASKED_KEY = 'blobocracy.nameAsked';

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string | null): void {
  try { if (v === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, v); } catch { /* keep it for this visit */ }
}

export const loadName = (): string | null => read(NAME_KEY);
export const saveName = (name: string | null): void => write(NAME_KEY, name);
/** True once the player has seen the name card (they chose a name or chose to stay anonymous). */
export const wasAsked = (): boolean => read(ASKED_KEY) === '1';
export const markAsked = (): void => write(ASKED_KEY, '1');
