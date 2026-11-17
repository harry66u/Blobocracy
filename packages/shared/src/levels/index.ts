import type { Level } from '../level';
import { LEVEL1 } from './level1';
import { LEVEL2 } from './level2';

export { LEVEL1, LEVEL2 };

/** Every built level, in id order: level n+1 unlocks when the world beats level n. */
export const LEVELS: readonly Level[] = [LEVEL1, LEVEL2];
