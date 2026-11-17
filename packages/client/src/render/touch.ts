// On-screen touch controls: three DOM <button>s styled like the mockup's cream discs.
// Pointer events with hit-testing on pointermove, so two thumbs work at once and a
// finger can slide from left to right without lifting. Shown only for coarse pointers.
import type { TouchZone } from '../input.ts';
import { INK, TOUCH_FILL } from './palette.ts';

export interface TouchButton { zone: TouchZone; cx: number; cy: number; r: number }

/** Button centers/radii in CSS px for a viewport, matching the mockup's phone layout. */
export function touchButtons(w: number, h: number): TouchButton[] {
  const phone = h > w * 1.15;
  const s = phone ? Math.min(1.3, Math.max(0.85, w / 390)) : Math.min(1.3, Math.max(0.9, h / 600));
  const y = phone ? h - 128 * s : h - 110 * s;
  return [
    { zone: 'left', cx: 58 * s, cy: y, r: 36 * s },
    { zone: 'right', cx: 140 * s, cy: y, r: 36 * s },
    { zone: 'jump', cx: w - 70 * s, cy: y, r: 46 * s },
  ];
}

/** Which button (if any) a point is over. Generous radius; left/right split at the nearer one. */
export function hitTouchZone(x: number, y: number, buttons: readonly TouchButton[]): TouchZone | null {
  let best: TouchZone | null = null, bestD = Infinity;
  for (const b of buttons) {
    const d = Math.hypot(x - b.cx, y - b.cy);
    if (d < b.r * 1.35 && d / b.r < bestD) {
      bestD = d / b.r;
      best = b.zone;
    }
  }
  return best;
}

/**
 * Multi-pointer bookkeeping: each pointer holds at most one zone; a zone is "down" while
 * any pointer holds it. Sliding a finger onto another button moves its hold there.
 */
export class TouchTracker {
  private readonly owner = new Map<number, TouchZone>();
  private readonly counts: Record<TouchZone, number> = { left: 0, right: 0, jump: 0 };

  constructor(
    private readonly input: { touch(zone: TouchZone, down: boolean): void },
    private readonly onVisual: (zone: TouchZone, down: boolean) => void = () => {},
  ) {}

  /** Pointer `id` is now over `zone` (null = over nothing, still touching). */
  set(id: number, zone: TouchZone | null): void {
    const prev = this.owner.get(id) ?? null;
    if (prev === zone) return;
    if (zone) {
      this.owner.set(id, zone);
      if (++this.counts[zone] === 1) { this.input.touch(zone, true); this.onVisual(zone, true); }
    } else this.owner.delete(id);
    if (prev && --this.counts[prev] === 0) { this.input.touch(prev, false); this.onVisual(prev, false); }
  }

  up(id: number): void {
    this.set(id, null);
  }

  releaseAll(): void {
    for (const id of [...this.owner.keys()]) this.set(id, null);
  }
}

const CHEVRONS: Record<TouchZone, string> = {
  left: 'M 6 -12 L -6 0 L 6 12',
  right: 'M -6 -12 L 6 0 L -6 12',
  jump: 'M -14 7 L 0 -8 L 14 7',
};
const LABELS: Record<TouchZone, string> = { left: 'Move left', right: 'Move right', jump: 'Jump' };

const STYLE = `
.bl-touch{position:fixed;inset:0;z-index:5;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;pointer-events:auto}
.bl-touch button{position:absolute;margin:0;padding:0;border-radius:50%;border:3px solid ${INK};background:${TOUCH_FILL};
  box-shadow:0 4px 0 rgba(42,27,61,.9);display:flex;align-items:center;justify-content:center;touch-action:none;
  transition:transform 60ms ease-out, box-shadow 60ms ease-out, background-color 60ms;cursor:pointer;-webkit-tap-highlight-color:transparent}
.bl-touch button.down{transform:translateY(3px);box-shadow:0 1px 0 rgba(42,27,61,.9);background:#F4E6C8}
.bl-touch button:focus-visible{outline:3px solid #FFD21F;outline-offset:3px}
.bl-touch button{transition:opacity .25s}
body.bl-dying .bl-touch button{opacity:.15}
.bl-touch svg{display:block;overflow:visible;pointer-events:none}
`;

/**
 * Mount the touch controls into `root`. Shown only when the device has a coarse pointer
 * (or `opts.force`). Returns an unmount function.
 */
export function mountTouchControls(
  root: HTMLElement,
  input: { touch(zone: TouchZone, down: boolean): void },
  opts: { force?: boolean } = {},
): () => void {
  const coarse = window.matchMedia('(pointer: coarse)');
  const style = document.createElement('style');
  style.textContent = STYLE;
  const layer = document.createElement('div');
  layer.className = 'bl-touch';
  const els = {} as Record<TouchZone, HTMLButtonElement>;
  for (const zone of ['left', 'right', 'jump'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', LABELS[zone]);
    b.innerHTML = `<svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="${CHEVRONS[zone]}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    // keyboard / assistive activation: press while held
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); press(-1 - ['left', 'right', 'jump'].indexOf(zone), zone); } });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') release(-1 - ['left', 'right', 'jump'].indexOf(zone)); });
    els[zone] = b;
    layer.appendChild(b);
  }

  let buttons = touchButtons(window.innerWidth, window.innerHeight);
  const placeButtons = () => {
    buttons = touchButtons(window.innerWidth, window.innerHeight);
    for (const b of buttons) {
      const el = els[b.zone];
      el.style.left = `${b.cx - b.r}px`;
      el.style.top = `${b.cy - b.r}px`;
      el.style.width = el.style.height = `${b.r * 2}px`;
      const svg = el.firstElementChild as SVGElement;
      // the mockup draws chevrons at 1:1 on a 36 px (move) / 46 px (jump) radius disc
      const px = 40 * (b.r / (b.zone === 'jump' ? 46 : 36));
      svg.style.width = svg.style.height = `${px}px`;
    }
    layer.style.display = opts.force || coarse.matches ? '' : 'none';
  };

  const tracker = new TouchTracker(input, (zone, down) => els[zone].classList.toggle('down', down));
  const tracking = new Set<number>();
  const press = (id: number, zone: TouchZone) => tracker.set(id, zone);
  const release = (id: number) => tracker.up(id);

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    // no implicit capture: moves are hit-tested so sliding between buttons works
    if (layer.hasPointerCapture?.(e.pointerId)) layer.releasePointerCapture(e.pointerId);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    tracking.add(e.pointerId);
    tracker.set(e.pointerId, hitTouchZone(e.clientX, e.clientY, buttons));
  };
  const onMove = (e: PointerEvent) => {
    if (!tracking.has(e.pointerId)) return;
    e.preventDefault();
    tracker.set(e.pointerId, hitTouchZone(e.clientX, e.clientY, buttons));
  };
  const onUp = (e: PointerEvent) => {
    if (!tracking.delete(e.pointerId)) return;
    tracker.up(e.pointerId);
  };
  const releaseAll = () => { tracking.clear(); tracker.releaseAll(); };
  const prevent = (e: Event) => e.preventDefault();

  layer.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', releaseAll);
  layer.addEventListener('contextmenu', prevent);
  layer.addEventListener('touchstart', prevent, { passive: false });
  window.addEventListener('resize', placeButtons);
  window.addEventListener('orientationchange', placeButtons);
  coarse.addEventListener('change', placeButtons);

  root.appendChild(style);
  root.appendChild(layer);
  placeButtons();

  return () => {
    releaseAll();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', releaseAll);
    window.removeEventListener('resize', placeButtons);
    window.removeEventListener('orientationchange', placeButtons);
    coarse.removeEventListener('change', placeButtons);
    layer.remove();
    style.remove();
  };
}
