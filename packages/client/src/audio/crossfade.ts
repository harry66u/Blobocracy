// Pure zone-transition math: which layers fade where, and how tempo glides.
import { LAYERS, zoneStyle, type Layer } from './patterns.ts';

export type LayerGains = Record<Layer, number>;

export interface GainRamp {
  layer: Layer;
  from: number;
  to: number;
  start: number;
  end: number;
}

/** 1 for the layers a zone plays, 0 for the rest. */
export function layerTargets(zone: number): LayerGains {
  const on = zoneStyle(zone).layers;
  const out = {} as LayerGains;
  for (const l of LAYERS) out[l] = on.includes(l) ? 1 : 0;
  return out;
}

/** Linear ramps from the current gains to `zone`'s targets, only for layers that change. */
export function planCrossfade(current: LayerGains, zone: number, start: number, duration: number): GainRamp[] {
  const target = layerTargets(zone);
  const out: GainRamp[] = [];
  for (const layer of LAYERS) {
    const from = current[layer], to = target[layer];
    if (Math.abs(from - to) > 1e-6) out.push({ layer, from, to, start, end: start + duration });
  }
  return out;
}

export function rampValue(r: GainRamp, t: number): number {
  if (t <= r.start) return r.from;
  if (t >= r.end) return r.to;
  return r.from + ((r.to - r.from) * (t - r.start)) / (r.end - r.start);
}

/**
 * Moves `current` toward `target` at the constant rate that covers `from` → `target`
 * in `fade` seconds; never overshoots.
 */
export function glideBpm(current: number, target: number, from: number, dt: number, fade: number): number {
  const rate = Math.abs(target - from) / fade;
  if (rate === 0) return target;
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
