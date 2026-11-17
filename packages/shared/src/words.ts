// Words for deaths, shared by the game's death card, the clip page, run history and the
// link previews rendered on the server, so everyone reads the same sentence for a run.

/** Several phrasings per cause. Each is the second half of "Run N made it P% of the way, …". */
export type CauseKey = 'press' | 'spikes' | 'ceiling spikes' | 'pit' | 'saw' | 'chomp';
export const CAUSE_LINES: Readonly<Record<CauseKey, readonly string[]>> = {
  press: [
    'then the Big Press flattened it.',
    'then the Big Press made a pancake of it.',
    'then the Big Press squashed it flat.',
    'then the Big Press came down. Hard.',
    'then the Big Press turned it into a sticker.',
  ],
  spikes: [
    'then the Spikes popped it.',
    'then the Spikes let the air out of it.',
    'then it sat on the Spikes. Pop.',
    'then the Spikes got their point across.',
    'then the Spikes poked a hole in the plan.',
  ],
  'ceiling spikes': [
    'then the Ceiling Spikes popped it.',
    'then it jumped right into the Ceiling Spikes.',
    'then the Ceiling Spikes said hello from above.',
    'then it bumped its head on the Ceiling Spikes. Pop.',
    'then the Ceiling Spikes let the air out of it.',
  ],
  pit: [
    'then the Pit swallowed it whole.',
    'then it fell into the Pit.',
    'then it waved goodbye from the Pit.',
    'then the Pit had the last word.',
    'then it found out how deep the Pit goes.',
  ],
  saw: [
    'then a Saw got it.',
    'then a Saw sliced it in two.',
    'then a Saw made two blobs of it.',
    'then it argued with a Saw and lost.',
    'then a Saw cut the run short.',
  ],
  chomp: [
    'then the Big Chomp ate it.',
    'then the Big Chomp gulped it down.',
    'then the Big Chomp caught up.',
    'then the Big Chomp had a snack.',
    'then the Big Chomp swallowed it in one bite.',
  ],
};

const CAUSE_NAMES: Readonly<Record<string, string>> = {
  spikes: 'Spikes', 'ceiling spikes': 'Ceiling Spikes', pit: 'Pit', press: 'Big Press', saw: 'Saw', chomp: 'Big Chomp',
};

/** Display name of a cause, e.g. 'press' → 'Big Press'. */
export function causeName(cause: string): string {
  return CAUSE_NAMES[cause] ?? cause;
}

/**
 * The cause line for a run, picked deterministically from the run number so every
 * player sees the same words, and two runs in a row never read exactly the same.
 */
export function deathLine(cause: string, run: number): string {
  const lines = (CAUSE_LINES as Readonly<Record<string, readonly string[] | undefined>>)[cause];
  if (!lines || lines.length === 0) return `then the ${causeName(cause)} got it.`;
  const n = lines.length;
  // step through the list with a stride coprime to n, so neighbours differ and all lines get used
  let stride = 2;
  while (gcd(stride, n) !== 1) stride++;
  const salt = cause.length * 3;
  const i = (((Math.floor(run) * stride + salt) % n) + n) % n;
  return lines[i]!;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}


/** "Run 4,812 made it 78% of the way, then the Big Press flattened it." */
export function deathSentence(run: number, progress: number, cause: string): string {
  return `Run ${Math.round(run).toLocaleString('en-US')} made it ${Math.round(progress * 100)}% of the way, ${deathLine(cause, run)}`;
}
