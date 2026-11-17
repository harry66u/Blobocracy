import { LEVEL1, tileAt } from '../packages/shared/src/index';
const x0 = Number(process.argv[2]), x1 = Number(process.argv[3]);
for (let y = 0; y < 18; y++) { let r = ''; for (let x = x0; x < x1; x++) r += '.#=^v~*><'[tileAt(LEVEL1, x, y)]; console.log(String(y).padStart(2), r); }
for (const e of LEVEL1.entities) if ((e as any).x >= x0 - 3 && (e as any).x < x1) console.log(JSON.stringify(e));
