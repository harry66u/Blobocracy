// A tiny builder for authoring level rooms in code, then emitting them as the ASCII the game
// parses (see packages/shared/src/level.ts for the legend). Every call is a deliberate
// placement; the builder only saves counting dots. Coordinates are room-local columns
// (x, left = 0) and rows (y, top = 0); ranges are inclusive. Ground defaults to rows 13..17.
import type { EntitySpec, Sky } from '../../packages/shared/src/index';

export const GROUND = 13;
const H = 18;

export class Room {
  readonly grid: string[][];
  readonly entities: Record<string, EntitySpec> = {};

  /** `intent` is the one-line comment every room carries: what it teaches or tests. */
  constructor(readonly name: string, readonly intent: string, readonly w: number, ground = GROUND) {
    this.grid = Array.from({ length: H }, (_, y) => Array.from({ length: w }, () => (y >= ground ? '#' : '.')));
  }

  private col(x: number): void {
    if (x < 0 || x >= this.w) throw new Error(`${this.name}: column ${x} outside 0..${this.w - 1}`);
  }

  /** Sets one tile (or entity marker / '@' / 'G'). */
  put(x: number, y: number, ch: string): this {
    this.col(x);
    if (y < 0 || y >= H) throw new Error(`${this.name}: row ${y} outside 0..17`);
    this.grid[y]![x] = ch;
    return this;
  }

  /** Fills the rectangle x0..x1 × y0..y1 with `ch`. */
  block(x0: number, x1: number, y0: number, y1: number, ch = '#'): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.put(x, y, ch);
    return this;
  }

  /** Empties whole columns x0..x1: a bottomless pit. */
  pit(x0: number, x1: number): this {
    return this.block(x0, x1, 0, H - 1, '.');
  }

  /** Columns x0..x1 become ground whose top is row `top` (empty above, solid below). */
  floor(x0: number, x1: number, top: number): this {
    this.block(x0, x1, 0, top - 1, '.');
    return this.block(x0, x1, top, H - 1, '#');
  }

  /** A one-row ledge (one-way '=' by default; '~' crumble, '#' solid, '>' '<' belts). */
  ledge(x0: number, x1: number, y: number, ch = '='): this {
    return this.block(x0, x1, y, y, ch);
  }

  /** Floor spikes on row `y` (default: standing on the default ground). */
  spikes(x0: number, x1: number, y = GROUND - 1): this {
    return this.block(x0, x1, y, y, '^');
  }

  /** A solid ceiling over rows 0..`bottom`, with ceiling spikes hanging under it unless `spiky` is false. */
  ceiling(x0: number, x1: number, bottom: number, spiky = true): this {
    this.block(x0, x1, 0, bottom, '#');
    if (spiky) this.block(x0, x1, bottom + 1, bottom + 1, 'v');
    return this;
  }

  /** An entity: marker letter `ch` at (x, y) with its spec. */
  ent(ch: string, x: number, y: number, spec: EntitySpec): this {
    if (!/^[A-FH-Z]$/.test(ch)) throw new Error(`${this.name}: bad marker '${ch}'`);
    if (this.entities[ch]) throw new Error(`${this.name}: marker '${ch}' used twice`);
    this.entities[ch] = spec;
    return this.put(x, y, ch);
  }

  rows(): string[] {
    return this.grid.map((r) => r.join(''));
  }
}

export interface Zone { name: string; sky: Sky; gravity?: number; rooms: Room[] }

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));
function specTs(s: EntitySpec): string {
  const parts = Object.entries(s).map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : num(v as number)}`);
  return `{ ${parts.join(', ')} }`;
}

function roomTs(r: Room): string {
  const rows = r.rows().map((row) => `'${row}',`);
  const out: string[] = [`  // ${r.name}: ${r.intent} (${r.w} cols)`];
  const keys = Object.keys(r.entities).sort();
  if (keys.length === 0) {
    out.push('  [', ...rows.map((x) => `    ${x}`), '  ],');
  } else {
    out.push('  {', '    rows: [', ...rows.map((x) => `      ${x}`), '    ],', '    entities: {');
    for (const k of keys) out.push(`      ${k}: ${specTs(r.entities[k]!)},`);
    out.push('    },', '  },');
  }
  return out.join('\n');
}

const ident = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
  .map((w, i) => (i === 0 ? w[0]!.toLowerCase() : w[0]!.toUpperCase()) + w.slice(1)).join('');

/** The TypeScript source of a level module exporting `exportName = parseLevel(id, version, zones)`. */
export function levelTs(opts: { id: number; version: number; exportName: string; header: string; zones: Zone[] }): string {
  const parts: string[] = [`import { parseLevel, type ZoneDef } from '../level';`, '', opts.header.trim(), ''];
  for (const z of opts.zones) {
    parts.push(`const ${ident(z.name)}: ZoneDef = {`, `  name: '${z.name}',`, `  sky: '${z.sky}',`);
    if (z.gravity !== undefined) parts.push(`  gravity: ${num(z.gravity)},`);
    parts.push('  rooms: [', ...z.rooms.map(roomTs), '  ],', '};', '');
  }
  parts.push(`export const ${opts.exportName} = parseLevel(${opts.id}, ${opts.version}, [${opts.zones.map((z) => ident(z.name)).join(', ')}]);`, '');
  return parts.join('\n');
}
