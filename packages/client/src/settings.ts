// The HUD's sound and settings buttons as real hit targets (invisible DOM buttons laid
// over the canvas icons), and the settings panel: sound, reduced motion and how to play.
// The panel is a modal dialog: keyboard operable, focus-trapped, Escape closes.
import type { Layout } from './layout.ts';
import { hudButtons } from './render/hud.ts';
import { BLOB, CREAM, CREAM_HI, HAZARD, INK } from './render/palette.ts';

const REDUCED_KEY = 'blobocracy.reducedMotion';
const MUTED_KEY = 'blobocracy.muted';

function readStore(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, v: string): void {
  try { window.localStorage.setItem(key, v); } catch { /* private mode or blocked storage: keep it for this visit */ }
}

/** Reduced motion: the player's saved choice, else what the OS asks for. */
export function loadReducedMotion(): boolean {
  const v = readStore(REDUCED_KEY);
  if (v === '1') return true;
  if (v === '0') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
export function saveReducedMotion(on: boolean): void { writeStore(REDUCED_KEY, on ? '1' : '0'); }
export function loadMuted(): boolean { return readStore(MUTED_KEY) === '1'; }
export function saveMuted(m: boolean): void { writeStore(MUTED_KEY, m ? '1' : '0'); }

export interface HudControlsOpts {
  layout(): Layout;
  muted(): boolean;
  setMuted(m: boolean): void;
  reduced(): boolean;
  setReduced(on: boolean): void;
}

export interface HudControls {
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** Re-place the hit targets (call when the layout changes). */
  place(): void;
  /** Refresh labels after muted/reduced changed elsewhere. */
  sync(): void;
}

const STYLE = `
.bl-hudbtn{position:fixed;z-index:7;margin:0;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.bl-hudbtn:focus-visible{outline:3px solid ${BLOB};outline-offset:2px;box-shadow:0 0 0 7px ${INK}}
.bl-hudbtn:hover{background:rgba(255,255,255,.18)}
.bl-modal{position:fixed;inset:0;z-index:20;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 24px 76px 24px;font-family:'Atkinson Hyperlegible Next',system-ui,sans-serif;color:${INK}}
.bl-modal[hidden]{display:none}
.bl-backdrop{position:absolute;inset:0;background:rgba(42,27,61,.28);animation:bl-fade .2s ease-out}
.bl-panel{position:relative;width:min(340px,100%);box-sizing:border-box;background:${CREAM};border:3.5px solid ${INK};border-radius:24px;box-shadow:0 7px 0 ${INK};padding:20px 22px 22px;transform:rotate(-1.2deg);animation:bl-pop .38s cubic-bezier(.34,1.56,.64,1)}
body.bl-reduced .bl-panel{animation:bl-fade .2s ease-out;transform:none}
@keyframes bl-pop{from{opacity:0;transform:translateY(24px) scale(.86) rotate(3deg)}to{opacity:1;transform:rotate(-1.2deg)}}
@keyframes bl-fade{from{opacity:0}to{opacity:1}}
.bl-panel h2{font:400 30px/1 'Bagel Fat One','Atkinson Hyperlegible Next',system-ui,sans-serif;margin:2px 0 14px;letter-spacing:.2px}
.bl-close{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;border:3px solid ${INK};background:${CREAM_HI};box-shadow:0 3px 0 ${INK};cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.bl-close:active{transform:translateY(2px);box-shadow:0 1px 0 ${INK}}
.bl-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-top:2px dashed rgba(42,27,61,.18)}
.bl-row b{display:block;font-weight:800;font-size:17px}
.bl-row small{display:block;font-weight:600;font-size:13.5px;color:rgba(42,27,61,.75);margin-top:2px}
.bl-switch{flex:none;position:relative;width:58px;height:34px;border-radius:17px;border:3px solid ${INK};background:#E9D6B8;cursor:pointer;padding:0;box-shadow:0 3px 0 ${INK};transition:background-color .18s}
.bl-switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:${CREAM_HI};border:2.5px solid ${INK};box-sizing:border-box;transition:transform .22s cubic-bezier(.34,1.56,.64,1)}
.bl-switch[aria-checked=true]{background:${BLOB}}
.bl-switch[aria-checked=true]::after{transform:translateX(24px)}
body.bl-reduced .bl-switch::after{transition:none}
.bl-switch:focus-visible,.bl-close:focus-visible{outline:3px solid ${HAZARD};outline-offset:3px}
.bl-how{border-top:2px dashed rgba(42,27,61,.18);padding-top:12px;margin:0;font-weight:600;font-size:14.5px;line-height:1.5}
.bl-how strong{font-weight:800}
.bl-how kbd{font:800 12.5px/1 'Atkinson Hyperlegible Next',system-ui,sans-serif;display:inline-block;min-width:13px;text-align:center;padding:3px 5px 2px;border:2px solid ${INK};border-bottom-width:3.5px;border-radius:7px;background:${CREAM_HI};margin:0 1px}
@media (max-height:520px),(max-width:520px){.bl-modal{align-items:center;justify-content:center;padding:16px}}
`;

const CLOSE_SVG = `<svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M-5-5L5 5M5-5L-5 5" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/></svg>`;

export function mountHudControls(root: HTMLElement, opts: HudControlsOpts): HudControls {
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);

  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.className = 'bl-hudbtn';
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'bl-hudbtn';
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.setAttribute('aria-haspopup', 'dialog');
  gearBtn.setAttribute('aria-expanded', 'false');
  root.append(soundBtn, gearBtn);

  const modal = document.createElement('div');
  modal.className = 'bl-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="bl-backdrop"></div>
    <div class="bl-panel" role="dialog" aria-modal="true" aria-labelledby="bl-set-title">
      <h2 id="bl-set-title">Settings</h2>
      <button type="button" class="bl-close" aria-label="Close settings">${CLOSE_SVG}</button>
      <div class="bl-row">
        <div id="bl-sound-l"><b>Sound</b><small>Music, jumps and the crowd</small></div>
        <button type="button" class="bl-switch" role="switch" data-k="sound" aria-labelledby="bl-sound-l"></button>
      </div>
      <div class="bl-row">
        <div id="bl-motion-l"><b>Reduced motion</b><small>No shakes or bounces, gentle fades</small></div>
        <button type="button" class="bl-switch" role="switch" data-k="motion" aria-labelledby="bl-motion-l"></button>
      </div>
      <p class="bl-how"><strong>How to play:</strong> <kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd> to move, <kbd>W</kbd>, <kbd>↑</kbd> or <kbd>Space</kbd> to jump (or the touch buttons). Hold jump longer to jump higher. Everyone online controls the same blob.</p>
    </div>`;
  root.appendChild(modal);
  const panel = modal.querySelector('.bl-panel') as HTMLElement;
  const closeBtn = modal.querySelector('.bl-close') as HTMLButtonElement;
  const soundSw = modal.querySelector('[data-k=sound]') as HTMLButtonElement;
  const motionSw = modal.querySelector('[data-k=motion]') as HTMLButtonElement;
  let lastFocus: HTMLElement | null = null;

  const sync = () => {
    const muted = opts.muted();
    soundBtn.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundSw.setAttribute('aria-checked', String(!muted));
    motionSw.setAttribute('aria-checked', String(opts.reduced()));
    document.body.classList.toggle('bl-reduced', opts.reduced());
  };

  const place = () => {
    for (const b of hudButtons(opts.layout())) {
      const el = b.kind === 'sound' ? soundBtn : gearBtn;
      // at least a 44 px target, centered on the drawn icon
      const r = Math.max(22, b.r + 6);
      el.style.left = `${b.cx - r}px`;
      el.style.top = `${b.cy - r}px`;
      el.style.width = el.style.height = `${r * 2}px`;
    }
  };

  const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>('button'));
  const open = () => {
    if (!modal.hidden) return;
    lastFocus = document.activeElement as HTMLElement | null;
    sync();
    modal.hidden = false;
    gearBtn.setAttribute('aria-expanded', 'true');
    soundSw.focus();
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    gearBtn.setAttribute('aria-expanded', 'false');
    (lastFocus && lastFocus !== document.body ? lastFocus : gearBtn).focus();
  };

  const toggleSound = () => { opts.setMuted(!opts.muted()); sync(); };
  soundBtn.addEventListener('click', toggleSound);
  soundSw.addEventListener('click', toggleSound);
  motionSw.addEventListener('click', () => { opts.setReduced(!opts.reduced()); sync(); });
  gearBtn.addEventListener('click', () => (modal.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);
  modal.querySelector('.bl-backdrop')!.addEventListener('click', close);
  // the HUD buttons must not start a touch-steer or be swallowed by the touch layer
  for (const el of [soundBtn, gearBtn]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });
  // keep focus inside while open (e.g. a click on the backdrop edge)
  document.addEventListener('focusin', (e) => {
    if (!modal.hidden && !panel.contains(e.target as Node)) soundSw.focus();
  });

  window.addEventListener('resize', place);
  window.visualViewport?.addEventListener('resize', place);
  place();
  sync();
  return { isOpen: () => !modal.hidden, open, close, place, sync };
}
