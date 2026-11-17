// Canvas host: keeps the backing store at CSS size × devicePixelRatio (recomputed on
// resize, orientation change and zoom), and waits for the self-hosted fonts.
import { computeLayout, type Layout } from './layout.ts';

export interface CanvasView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Current layout; replaced (new object) whenever the size or dpr changes. */
  layout: Layout;
  destroy(): void;
}

const MAX_DPR = 3;

export function createCanvasView(canvas: HTMLCanvasElement, onResize?: (layout: Layout) => void): CanvasView {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  let dprQuery: MediaQueryList | null = null;

  const view: CanvasView = {
    canvas,
    ctx,
    layout: computeLayout(1, 1, 1),
    destroy() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      dprQuery?.removeEventListener('change', onDpr);
    },
  };

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const l = view.layout;
    if (l.w !== w || l.h !== h || l.dpr !== dpr) {
      view.layout = computeLayout(w, h, dpr);
      onResize?.(view.layout);
    }
  }
  function onDpr(): void {
    watchDpr();
    resize();
  }
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  window.visualViewport?.addEventListener('resize', resize);
  watchDpr();
  resize();
  return view;
}

/** Resolve once Bagel Fat One and Atkinson Hyperlegible Next (400–800) are ready for canvas text. */
export async function loadFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const specs = [
    "400 32px 'Bagel Fat One'",
    "400 16px 'Atkinson Hyperlegible Next'",
    "600 16px 'Atkinson Hyperlegible Next'",
    "700 16px 'Atkinson Hyperlegible Next'",
    "800 16px 'Atkinson Hyperlegible Next'",
  ];
  try {
    await Promise.race([
      Promise.all(specs.map((f) => document.fonts.load(f, '0123456789,%+ Record deaths you'))).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch {
    // draw with fallbacks rather than never
  }
}
