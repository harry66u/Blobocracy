import {
  DT, FRAME_CRUMBLE_RANGE, FRAME_EVERY, LEVEL1, MAX_FRAME_CRUMBLES, encodeState, nearbyCrumbles, type Level,
} from '@blobocracy/shared';
import { Voters } from './crowd';
import { startLocalRelay } from './relay';
import { VirtualCrowd } from './virtual';
import { World } from './world';

const MAX_CATCHUP_STEPS = 5;

/** Wires the world, voters, optional virtual crowd and the local relay into a 60 Hz loop. */
export async function startServer(opts: { port: number; virtualPlayers: number; level?: Level }) {
  const world = new World(opts.level ?? LEVEL1);
  const voters = new Voters();
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const relay = await startLocalRelay({ port: opts.port, voters, world, clock });
  const crowd = opts.virtualPlayers > 0 ? new VirtualCrowd(voters, opts.virtualPlayers, 42) : null;

  let simTime = clock();
  const loop = setInterval(() => {
    const now = clock();
    let steps = 0;
    while (simTime + DT <= now && steps < MAX_CATCHUP_STEPS) {
      simTime += DT;
      steps++;
      crowd?.update(simTime, world);
      const counts = voters.counts(simTime);
      for (const e of world.step(counts)) relay.broadcastEvent(e);
      if (world.tick % FRAME_EVERY === 0) {
        const { dots, dotJump } = voters.sample();
        const b = world.body, k = world.lastBlend, dyn = world.dyn;
        relay.broadcast(encodeState({
          tick: world.tick, run: world.run, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          grounded: b.grounded, facing: b.facing, phase: world.phase,
          pull: k.pull, pressure: k.pressure, strain: k.strain, jumpHeld: k.jumpHeld,
          online: voters.size(), active: counts.active, dots, dotJump,
          runTime: dyn.t, chompStart: dyn.chompStart,
          crumbles: nearbyCrumbles(dyn, world.level, b.x, FRAME_CRUMBLE_RANGE, MAX_FRAME_CRUMBLES),
        }));
      }
    }
    if (steps === MAX_CATCHUP_STEPS) simTime = now; // fell behind: drop time rather than spiral
  }, 4);

  return {
    port: relay.port,
    world,
    stop: async () => { clearInterval(loop); await relay.close(); },
  };
}
