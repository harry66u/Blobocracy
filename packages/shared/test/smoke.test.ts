import { expect, test } from 'vitest';
import { DT } from '../src/index';
test('fixed timestep is 1/60', () => { expect(DT).toBe(1 / 60); });
