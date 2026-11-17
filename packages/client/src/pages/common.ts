// Shared by /runs and /hall: the live flip-card death counter and JSON fetching.
import { fmt, flipChars } from './format.ts';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Counter { deaths: number; run: number; record: { progress: number; run: number } | null; online: number }

/**
 * Split-flap death counter in the DOM (the HUD's, as cards). Digits that change flip and light
 * up yellow for a moment, with a "+1" pop, like the game's counter on a death.
 */
export function mountFlip(el: HTMLElement, label: (n: number) => string) {
  el.classList.add('flip');
  el.setAttribute('role', 'img');
  let shown: string[] = [];
  const set = (n: number, animate: boolean) => {
    const next = flipChars(n);
    el.setAttribute('aria-label', label(n));
    if (next.length !== shown.length || !animate) {
      el.innerHTML = next.map((c) => (c === ',' ? '<span class="sep">,</span>' : `<span class="card">${c}</span>`)).join('');
    } else {
      const nodes = [...el.children] as HTMLElement[];
      next.forEach((c, i) => {
        if (c === shown[i]) return;
        const card = nodes[i]!;
        card.classList.remove('tick');
        void card.offsetWidth; // restart the animation
        card.classList.add('tick');
        setTimeout(() => { card.textContent = c; }, 210);
        setTimeout(() => card.classList.remove('tick'), 1400);
      });
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = `+${Math.max(1, n - Number(shown.join('').replace(/,/g, '')))}`;
      plus.style.left = `${el.offsetWidth - 10}px`;
      plus.style.top = '-.2em';
      el.style.position = 'relative';
      el.appendChild(plus);
      setTimeout(() => plus.remove(), 1200);
    }
    shown = next;
  };
  return { set };
}

/** Polls /api/counter (cached 5 s at the edge) and calls back on every change. */
export function watchCounter(onChange: (c: Counter) => void, everyMs = 5000): void {
  let last = '';
  const tick = async () => {
    try {
      const c = await getJson<Counter>('/api/counter');
      const key = JSON.stringify(c);
      if (key !== last) { last = key; onChange(c); }
    } catch { /* keep the last numbers */ }
  };
  void tick();
  setInterval(() => { if (!document.hidden) void tick(); }, everyMs);
}

export { fmt };
