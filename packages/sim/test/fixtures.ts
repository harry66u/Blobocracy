import { parseLevel, type VoteCounts } from '@blobocracy/shared';

/** 18-row room from a ground profile string: '#' floor at row 13, '_' pit; '@' spawn / 'G' goal on row 12. */
export function room(profile: string, spawnAt = -1, goalAt = -1): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 18; r++) {
    let row = '';
    for (let c = 0; c < profile.length; c++) {
      if (r === 12 && c === spawnAt) row += '@';
      else if (r === 12 && c === goalAt) row += 'G';
      else row += r >= 13 && profile[c] === '#' ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

/** Two tiny levels a lone voter holding right beats in about a second each. */
export const TINY1 = parseLevel(1, 1, [
  { name: 'Start', sky: 'blue', rooms: [room('########', 1)] },
  { name: 'Crown', sky: 'purple', rooms: [room('##########', -1, 6)] },
], 'Tiny Hill');
export const TINY2 = parseLevel(2, 3, [
  { name: 'Again', sky: 'sunset', rooms: [room('############', 1)] },
  { name: 'Top', sky: 'purple', rooms: [room('##########', -1, 6)] },
], 'Tiny Peak');
export const TINY = [TINY1, TINY2] as const;

export const NOBODY: VoteCounts = { left: 0, right: 0, jump: 0, active: 0 };
export const RIGHT: VoteCounts = { left: 0, right: 1, jump: 0, active: 1 };
export const LEFT: VoteCounts = { left: 1, right: 0, jump: 0, active: 1 };
export const JUMP_LEFT: VoteCounts = { left: 1, right: 0, jump: 1, active: 1, fresh: 1 };
