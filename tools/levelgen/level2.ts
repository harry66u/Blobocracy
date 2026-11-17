// Level 2 ("the encore after the internet beats level 1"), authored room by room with the
// builder in ./room.ts and emitted as ASCII to packages/shared/src/levels/level2.ts.
// Regenerate after editing:  npx tsx tools/levelgen/level2.ts
// Then prove it:             npx tsx tools/solve-level.ts 2 250 --chain   (or --zone=N)
//                            npx vitest run packages/shared/test/level2.test.ts
// Preview:                   npx tsx tools/level-preview.ts --level=2
//
// Same six-zone shape as level 1, every idea escalated (shorter press periods, narrower
// ledges, longer crumble chains, faster ferries, a faster Big Chomp) plus the two new
// mechanics: wind gusts (entity 'wind') everywhere, and a low-gravity zone (gravity 0.6).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntitySpec } from '../../packages/shared/src/index';
import { levelTs, Room, type Zone } from './room';

const W = (push: number, period: number, o: { w: number; h?: number; phase?: number; gustS?: number; base?: number }): EntitySpec =>
  ({ kind: 'wind', w: o.w, ...(o.h !== undefined ? { h: o.h } : {}), push, period, ...(o.phase ? { phase: o.phase } : {}), ...(o.gustS !== undefined ? { gustS: o.gustS } : {}), ...(o.base ? { base: o.base } : {}) });
const PRESS = (period: number, phase = 0, extra: Partial<{ holdS: number; upS: number; downS: number }> = {}): EntitySpec =>
  ({ kind: 'crusher', w: 2.4, drop: 5.28, period, ...(phase ? { phase } : {}), ...extra });
const FERRY = (dx: number, dy: number, period: number, phase = 0): EntitySpec =>
  ({ kind: 'mover', w: 3, dx, dy, period, ...(phase ? { phase } : {}) });
const SAW = (o: { dx?: number; dy?: number; period?: number; phase?: number; r?: number }): EntitySpec =>
  ({ kind: 'saw', r: o.r ?? 0.8, ...(o.dx ? { dx: o.dx } : {}), ...(o.dy ? { dy: o.dy } : {}), ...(o.period ? { period: o.period } : {}), ...(o.phase ? { phase: o.phase } : {}) });

const rest = (name: string, intent: string) => new Room(name, intent, 16);

// ---- Zone 1: Breezy Bluffs -------------------------------------------------------------
// Level 1's first two zones in one breath, plus the first wind: tailwinds that help and
// headwinds that hinder. Signature: "Kite Leap", a gap only a tailwind gust carries you over.
const breezyBluffs: Zone = {
  name: 'Breezy Bluffs', sky: 'blue', rooms: [
    new Room('Hello Again', 'Walk right together again; a friendly tailwind gust nudges the blob along.', 40)
      .put(3, 12, '@').pit(14, 15).pit(26, 28)
      .ent('W', 17, 5, W(2.5, 3, { w: 22, h: 8 })),
    new Room('Headwind', 'A headwind gusts against single and double spikes: jump in the calm, or jump early.', 44)
      .spikes(9, 9).spikes(17, 18).spikes(26, 26).spikes(33, 34)
      .ent('W', 2, 5, W(-3, 3.2, { w: 38, h: 8, gustS: 1.4 })),
    new Room('Gusty Steps', 'Steps up and down over 3- and 4-gaps, a spike on the top step.', 46)
      .floor(6, 12, 11).floor(13, 18, 10).spikes(16, 16, 9).pit(19, 22).floor(23, 30, 12).pit(31, 33),
    new Room('Windmill Steps', 'A staircase up into a gusting headwind, a spike on the top step, then a 4-gap.', 44)
      .floor(5, 9, 12).floor(10, 14, 11).floor(15, 19, 10).floor(20, 24, 9).spikes(22, 22, 8).pit(25, 28).floor(29, 35, 11)
      .ent('W', 12, 3, W(-3, 2.8, { w: 24, h: 10, gustS: 1.2 })),
    new Room('Kite Leap', 'A 7-wide gap no jump can clear in calm air: wait for the tailwind gust and ride it over.', 40)
      .pit(22, 28)
      .ent('W', 8, 4, W(3.5, 3, { w: 24, h: 9, gustS: 1.5 })),
    new Room('Swirl', 'A tailwind half and a headwind half, gusting out of step: the same gap plays differently on each side.', 44)
      .pit(10, 13).spikes(18, 19).pit(27, 30).spikes(36, 36)
      .ent('W', 0, 4, W(3, 3, { w: 22, h: 9, gustS: 1.4 })).ent('V', 22, 4, W(-3, 3, { w: 22, h: 9, gustS: 1.4, phase: 0.5 })),
    new Room('Cliff Hops', 'Up two, down two, over 4-gaps, a spike on the high cliff.', 44)
      .floor(6, 11, 11).pit(12, 15).floor(16, 21, 9).spikes(19, 19, 8).pit(22, 25).floor(26, 31, 11).pit(32, 35),
    new Room('Spike Garden', 'Triple spike clusters with short landings, then a ledge over a long spike bed.', 44)
      .spikes(5, 7).spikes(11, 13).spikes(17, 18).spikes(22, 24).spikes(29, 36).ledge(31, 33, 10),
    new Room('Gusty Ledges', 'Floating ledges over a pit while a headwind gusts: leap in the lulls.', 46)
      .pit(6, 37).ledge(10, 12, 12).ledge(18, 20, 10).ledge(26, 28, 11).ledge(34, 36, 12)
      .ent('W', 0, 4, W(-2.5, 3.4, { w: 46, h: 10, gustS: 1.4, phase: 0.3 })),
    new Room('Double Trouble', 'Land, hop at once: 4-gaps with spikes right behind each landing.', 46)
      .pit(6, 9).spikes(12, 12).pit(18, 21).spikes(24, 25).pit(31, 34).block(38, 41, 12, 12).spikes(36, 36),
    new Room('Hopscotch', 'Spike pairs on alternating low and high steps: small hops, steady rhythm.', 42)
      .spikes(5, 6).block(10, 16, 11, 12).spikes(13, 13, 10).spikes(20, 21).block(25, 31, 11, 12).spikes(27, 28, 10).spikes(35, 36),
    new Room('Ledge Run', 'Three floating ledges over three pits, each a row higher, in a gusting headwind.', 44)
      .pit(6, 12).ledge(8, 10, 12).pit(17, 23).ledge(19, 21, 11).pit(28, 34).ledge(30, 32, 10)
      .ent('W', 2, 4, W(-2.5, 3, { w: 38, h: 10, gustS: 1.2, phase: 0.2 })),
    new Room('Long Lawn', 'Gaps of 3, 4 and 5 with spikes on the landings, then a 7-gap with a tailwind.', 60)
      .pit(6, 8).spikes(12, 12).pit(17, 20).spikes(24, 25).pit(30, 34).spikes(38, 38).pit(45, 51)
      .ent('W', 39, 4, W(3.5, 2.8, { w: 16, h: 9, gustS: 1.4, phase: 0.4 })),
    new Room('Breezy Ledges', 'One-way ledges up and down over a pit while a tailwind tries to carry the blob past each one.', 46)
      .pit(5, 40).ledge(8, 10, 12).ledge(14, 16, 10).ledge(20, 22, 8).ledge(26, 28, 10).ledge(32, 34, 12).ledge(38, 40, 11)
      .ent('W', 2, 3, W(3, 2.8, { w: 40, h: 11, gustS: 1.2, base: 0.2 })),
    new Room('Steady Breeze', 'A headwind that never quite stops over spike pairs and triples: the triples need the lulls.', 48)
      .spikes(6, 7).spikes(13, 14).spikes(20, 22).spikes(28, 29).spikes(35, 37).spikes(43, 44)
      .ent('W', 2, 5, W(-2.5, 3, { w: 46, h: 8, gustS: 1.5, base: 0.4 })),
    new Room('Pebbles', 'One-wide stones over a long pit, alternating heights: land on a pin.', 42)
      .pit(6, 35).floor(9, 9, 12).floor(13, 13, 11).floor(17, 17, 12).floor(21, 21, 10).floor(25, 25, 12).floor(29, 29, 11).floor(32, 32, 12),
    rest('Breather', 'Calm air at the end of zone 1 for the zone banner.'),
  ],
};

// ---- Zone 2: Bramble Gale ----------------------------------------------------------------
// Pointy Meadow, sharper: 3-wide spike fields, ceiling spikes, one-wide needles, and gusts
// that try to blow the blob off narrow pillars. Signature: "The Gale Haircut".
const brambleGale: Zone = {
  name: 'Bramble Gale', sky: 'blue', rooms: [
    new Room('Bramble Field', 'Ten spike fields, most three wide, with two-wide islands between: long jump, land, again.', 60)
      .spikes(5, 7).spikes(10, 12).spikes(15, 17).spikes(20, 21).spikes(24, 26).spikes(29, 31).spikes(35, 37).spikes(40, 42).spikes(46, 48).spikes(52, 53),
    new Room('Low Branch Gust', 'Ceiling spikes four rows up while a headwind gusts: let go of jump early, every time.', 40)
      .ceiling(8, 31, 8).spikes(14, 14).spikes(22, 23)
      .ent('W', 4, 9, W(-2.5, 2.8, { w: 32, h: 5, gustS: 1.2 })),
    new Room('Needles', 'One-wide needles over a long drop, climbing then descending.', 42)
      .pit(5, 36).floor(8, 8, 12).floor(11, 11, 10).floor(14, 14, 9).floor(17, 17, 9).floor(21, 21, 11).floor(25, 25, 12).floor(29, 29, 12).floor(33, 33, 11),
    new Room('Blown Stones', 'Two-wide one-way stones at staggered heights while a tailwind gust tries to carry the blob past them.', 42)
      .pit(5, 37).ledge(9, 10, 11).ledge(15, 16, 9).ledge(21, 22, 11).ledge(27, 28, 8).ledge(33, 34, 11)
      .ent('W', 2, 3, W(3, 3, { w: 38, h: 11, gustS: 1.2 })),
    new Room('Low Ledges', 'Floating ledges under a spiky ceiling: hop short between them.', 32)
      .pit(4, 27).ceiling(3, 28, 6).ledge(6, 8, 11).ledge(12, 14, 11).ledge(18, 20, 11).ledge(24, 26, 12),
    new Room('Thorny Tunnel', 'Ceiling spikes over spike clusters: hop low and short, again and again.', 46)
      .ceiling(6, 40, 8).spikes(10, 11).spikes(16, 16).spikes(21, 22).spikes(28, 28).spikes(33, 34),
    new Room('Crosswind Pillars', 'Two-wide pillars over a pit; a gust shoves the blob toward the edge: lean into it.', 44)
      .pit(5, 38).floor(8, 9, 12).floor(13, 14, 11).floor(18, 19, 10).floor(23, 24, 11).floor(28, 29, 12).floor(33, 34, 11)
      .ent('W', 2, 4, W(3.5, 2.6, { w: 40, h: 10, gustS: 1.2 })),
    new Room('Gusty Needles', 'One-wide needles in a crosswind: land on a pin while the gust leans on you.', 42)
      .pit(4, 37).floor(7, 7, 12).floor(11, 11, 11).floor(15, 15, 11).floor(19, 19, 10).floor(23, 23, 11).floor(27, 27, 12).floor(31, 31, 11).floor(35, 35, 12)
      .ent('W', 2, 3, W(2.5, 2.4, { w: 38, h: 11, gustS: 1, phase: 0.25 })),
    new Room('Crooked Stairs', 'Down-and-up steps with 3-gaps between them; every landing is short.', 44)
      .pit(6, 8).floor(9, 13, 11).pit(14, 16).floor(17, 20, 9).pit(21, 23).floor(24, 28, 11).pit(29, 31).floor(32, 35, 12).pit(36, 38),
    new Room('The Gale Haircut', 'A 30-column corridor under ceiling spikes with five 2-wide gaps and a gusting headwind: only quick taps survive.', 46)
      .ceiling(4, 33, 8).pit(8, 9).pit(14, 15).pit(20, 21).pit(26, 27).pit(31, 32)
      .ent('W', 2, 9, W(-2.5, 2.8, { w: 34, h: 5, gustS: 1.2, phase: 0.5 })),
    new Room('Thorn Walk', 'Three-wide spike rows, the middle ones under a low ceiling: long jumps outside, short ones under it.', 46)
      .spikes(6, 8).spikes(13, 15).spikes(20, 21).spikes(27, 28).spikes(34, 36).ceiling(17, 31, 7),
    new Room('Bramble Bridge', 'One-way ledges over a spike bed, with a headwind gusting: leap between them in the lulls.', 38)
      .spikes(4, 32).ledge(7, 9, 10).ledge(13, 16, 10).ledge(20, 23, 10).ledge(27, 30, 10).floor(4, 6, 13).spikes(4, 6)
      .ent('W', 2, 4, W(-2.5, 3, { w: 34, h: 9, gustS: 1.2 })),
    new Room('Briar Corridor', 'Ceiling spikes over spikes and 2-gaps while a tailwind gusts: now the wind shoves you at the thorns.', 44)
      .ceiling(5, 38, 8).spikes(10, 10).pit(15, 16).spikes(21, 22).pit(27, 28).spikes(33, 33)
      .ent('W', 3, 9, W(2.5, 2.6, { w: 38, h: 5, gustS: 1 })),
    new Room('Spike Steps', 'Climb and descend steps with single spikes on top.', 46)
      .floor(5, 9, 12).floor(10, 14, 11).spikes(12, 12, 10).floor(15, 19, 10).spikes(17, 17, 9).floor(20, 24, 9).pit(25, 27).floor(28, 32, 10).spikes(30, 30, 9).floor(33, 37, 11).floor(38, 41, 12).spikes(40, 40, 11),
    new Room('Bramble Hops', 'A long spiky ceiling over 3-gaps and single spikes: tiny hops only, all the way.', 44)
      .ceiling(4, 40, 8).pit(9, 11).spikes(14, 14).pit(18, 20).spikes(23, 23).pit(27, 29).spikes(32, 32).pit(35, 37),
    new Room('Thorn Ladder', 'Up a ladder of pillars, then down into a ceiling-spiked dip.', 42)
      .pit(5, 41).floor(5, 7, 11).floor(10, 12, 9).floor(15, 17, 7).floor(21, 23, 9).floor(26, 41, 13).ceiling(27, 37, 8).spikes(31, 32),
    rest('Breather', 'Calm air at the end of zone 2 for the zone banner.'),
  ],
};

// ---- Zone 3: The Pistonworks -------------------------------------------------------------
// The Grinder, faster: presses on a 2.0-2.4 s beat, ferries on 3.0-3.6 s, and wind that
// shoves the blob along while it waits. Signature: "The Mangle".
const pistonworks: Zone = {
  name: 'The Pistonworks', sky: 'sunset', rooms: [
    new Room('Quick Press', 'One Big Press on a quick beat: stop, wait, go, on a shorter fuse than before.', 30)
      .ent('A', 14, 5, PRESS(2.2)),
    new Room('Press Row', 'Three quick presses a third of a beat apart.', 34)
      .ent('A', 6, 5, PRESS(2.2)).ent('B', 14, 5, PRESS(2.2, 0.33)).ent('C', 22, 5, PRESS(2.2, 0.66)),
    new Room('Fast Ferry', 'A 14-wide pit crossed by a brisk ferry: hop on, ride, hop off.', 30)
      .pit(8, 21).ent('A', 8, 13, FERRY(8, 0, 3.2)),
    new Room('Blown Ferry', 'A long ferry ride into a gusting headwind that tries to blow the blob off the back.', 36)
      .pit(6, 27).ent('A', 6, 13, FERRY(15, 0, 4)).ent('W', 6, 6, W(-2, 2.4, { w: 22, h: 8, gustS: 1 })),
    new Room('The Mangle', 'Four-wide islands over a pit, each under its own press: jump, wait, jump, wait.', 48)
      .pit(5, 40).floor(8, 11, 13).floor(16, 19, 13).floor(24, 27, 13).floor(32, 35, 13)
      .ent('A', 9, 5, PRESS(2.2)).ent('B', 17, 5, PRESS(2.2, 0.25)).ent('C', 25, 5, PRESS(2.2, 0.5)).ent('D', 33, 5, PRESS(2.2, 0.75)),
    new Room('Press Plaza', 'Stepping stones at three heights, each under its own press on its own beat.', 42)
      .pit(4, 39).floor(6, 9, 13).floor(13, 16, 12).floor(20, 23, 11).floor(27, 30, 12).floor(34, 37, 13)
      .ent('A', 7, 5, PRESS(2.6)).ent('B', 14, 4, PRESS(2.6, 0.4)).ent('C', 21, 3, PRESS(2.6, 0.8)).ent('D', 28, 4, PRESS(2.6, 0.2)).ent('E', 35, 5, PRESS(2.6, 0.6)),
    new Room('Lift Press', 'A quick lift up to a high shelf guarded by a press.', 32)
      .pit(8, 16).floor(17, 31, 8).ent('A', 13, 13, FERRY(0, -5, 3.6)).ent('B', 22, 0, PRESS(2.2, 0.4)),
    new Room('Windy Gauntlet', 'Five presses on a wave while a tailwind gust pushes the blob under them.', 46)
      .ent('A', 6, 5, PRESS(2.2)).ent('B', 13, 5, PRESS(2.2, 0.2)).ent('C', 20, 5, PRESS(2.2, 0.4)).ent('D', 27, 5, PRESS(2.2, 0.6)).ent('E', 34, 5, PRESS(2.2, 0.8))
      .ent('W', 2, 6, W(2.5, 3, { w: 40, h: 7, gustS: 1.2 })),
    new Room('Ferry Chain', 'Three quick ferries over one long pit, handing the blob along.', 42)
      .pit(6, 35).ent('A', 6, 13, FERRY(6, 0, 3)).ent('B', 15, 13, FERRY(6, 0, 3, 0.5)).ent('C', 24, 13, FERRY(6, 0, 3)),
    new Room('Ferry Hop', 'Hop from ferry to ferry in mid-pit: both must line up.', 36)
      .pit(4, 31).ent('A', 4, 13, FERRY(6, 0, 3.2)).ent('B', 17, 11, FERRY(7, 0, 3.2, 0.5)),
    new Room('Elevator Gust', 'A quick lift to a shelf, then a ferry down across the pit through a gusting headwind.', 34)
      .pit(5, 29).floor(10, 15, 7).ent('A', 6, 13, FERRY(0, -6, 3.2)).ent('B', 16, 7, FERRY(8, 6, 3.6)).ent('W', 14, 3, W(-2, 2.6, { w: 16, h: 10, gustS: 1 })),
    new Room('Press Ferry Press', 'A press, a ferry, a press: three waits in a row.', 36)
      .pit(10, 25).ent('A', 4, 5, PRESS(2.4, 0.1)).ent('B', 10, 13, FERRY(10, 0, 3.4)).ent('C', 29, 5, PRESS(2.4, 0.6)),
    new Room('Double Ferry Press', 'Two ferries out of step, then a press right on the landing.', 40)
      .pit(4, 29).ent('A', 4, 13, FERRY(6, 0, 3.2)).ent('B', 16, 13, FERRY(6, 0, 3.2, 0.5)).ent('C', 31, 5, PRESS(2.4, 0.3)),
    new Room('Twin Lifts', 'A lift up to a shelf and another back down the far side, on a quick beat.', 32)
      .pit(5, 21).floor(10, 17, 7).ent('A', 6, 13, FERRY(0, -6, 3.6)).ent('B', 18, 7, FERRY(0, 6, 3.6, 0.5)),
    new Room('Press Stairs', 'Stairs up and down with a press on every step, rippling on a 2-second wave.', 40)
      .floor(6, 11, 12).floor(12, 17, 11).floor(18, 23, 10).floor(24, 29, 11).floor(30, 35, 12)
      .ent('A', 8, 4, PRESS(2)).ent('B', 14, 3, PRESS(2, 0.2)).ent('C', 20, 2, PRESS(2, 0.4)).ent('D', 26, 3, PRESS(2, 0.6)).ent('E', 32, 4, PRESS(2, 0.8)),
    new Room('Pendulum Presses', 'Long-hold presses with 2-wide pits between them: rhythm over speed.', 40)
      .pit(9, 10).pit(16, 17).pit(23, 24).pit(30, 31)
      .ent('A', 5, 5, PRESS(3.2, 0, { holdS: 1 })).ent('B', 12, 5, PRESS(3.2, 0.5, { holdS: 1 })).ent('C', 19, 5, PRESS(3.2, 0, { holdS: 1 })).ent('D', 26, 5, PRESS(3.2, 0.5, { holdS: 1 })),
    rest('Sunset Rest', 'Calm air at the end of zone 3.'),
  ],
};

// ---- Zone 4: Moonbounce Mesa (low gravity) ----------------------------------------------
// Gravity 0.6: jumps go 5 rows high and 8 tiles long, springs throw the blob 9 rows up.
// Wider gaps, crumbling chains, and ceilings that punish holding jump. Signature: "The Big Float".
const moonbounceMesa: Zone = {
  name: 'Moonbounce Mesa', sky: 'sunset', gravity: 0.6, rooms: [
    new Room('Moon Step', 'The first floaty jump: a 7-wide gap up onto a mesa four rows high, then a 6-gap down.', 40)
      .pit(9, 15).floor(16, 23, 9).pit(24, 29),
    new Room('Moon Bridge', 'A long crumbling bridge with two wide gaps: float across, never stop.', 52)
      .pit(5, 44).ledge(5, 14, 13, '~').ledge(20, 30, 13, '~').ledge(37, 44, 13, '~'),
    new Room('Moon Ceiling', 'Ceiling spikes five rows up: a floaty full jump hits them, so taps only.', 44)
      .ceiling(6, 37, 7).spikes(12, 13).spikes(20, 20).spikes(27, 28).spikes(33, 33),
    new Room('Crater Hops', 'Three 7-wide craters with spikes waiting on the landings.', 50)
      .pit(6, 12).spikes(17, 17).pit(21, 27).spikes(31, 32).pit(36, 42).spikes(46, 46),
    new Room('Moonspring', 'A spring throws the blob nine rows up onto a mesa; spikes wait on top.', 38)
      .put(10, 13, '*').floor(16, 30, 5).spikes(22, 23, 4),
    new Room('The Big Float', 'Crumbling three-wide ledges over a long fall, six apart: leap, land, leap again.', 58)
      .pit(4, 53).ledge(9, 11, 11, '~').ledge(18, 20, 9, '~').ledge(27, 29, 11, '~').ledge(36, 38, 8, '~').ledge(45, 47, 10, '~'),
    new Room('Moon Pillars', 'One-wide pillars five and six apart: floaty leaps onto pins.', 44)
      .pit(4, 39).floor(9, 9, 12).floor(15, 15, 10).floor(21, 21, 9).floor(28, 28, 11).floor(34, 34, 12),
    new Room('Spring Trap', 'Springs set in the floor under a spiky sky: here a bounce is the hazard, so hop over them.', 36)
      .ceiling(6, 32, 3).put(10, 13, '*').put(11, 13, '*').put(18, 13, '*').put(19, 13, '*').put(26, 13, '*').put(27, 13, '*').spikes(14, 14).spikes(23, 23),
    new Room('Crumble Stairs', 'Crumbling steps three rows apart, up to the sky and back down.', 44)
      .pit(5, 39).ledge(6, 9, 11, '~').ledge(13, 16, 8, '~').ledge(20, 23, 5, '~').ledge(27, 30, 8, '~').ledge(34, 37, 11, '~'),
    new Room('Kite Field', 'Two 7-gaps under a gusting headwind: a floaty jump in a gust falls short, so leap in the lulls.', 48)
      .pit(8, 14).pit(23, 29).ent('W', 2, 3, W(-3, 3, { w: 34, h: 11, gustS: 1.3 })),
    new Room('Spring Ladder', 'Springs on narrow pillars, each one higher: bounce, steer, bounce.', 48)
      .pit(4, 39).floor(8, 9, 12).put(8, 12, '*').put(9, 12, '*').floor(16, 17, 11).put(16, 11, '*').put(17, 11, '*')
      .floor(24, 25, 10).put(24, 10, '*').put(25, 10, '*').floor(32, 33, 9).put(32, 9, '*').put(33, 9, '*').floor(40, 47, 7),
    new Room('Fall Away', 'A crumbling shelf over a spike bed, up to a high ledge at the end.', 42)
      .floor(6, 32, 13).ledge(6, 32, 9, '~').spikes(6, 32).floor(33, 41, 6),
    new Room('Float Ferry', 'A low ferry and a high one over a long pit: hop up from one to the other.', 40)
      .pit(5, 32).ent('A', 5, 13, FERRY(10, 0, 3.2)).ent('B', 20, 9, FERRY(8, 0, 3.2, 0.5)),
    new Room('Lantern Lift', 'A quick lift with crumbling ledges hanging off its path.', 38)
      .pit(5, 29).floor(30, 37, 10).ledge(13, 16, 8, '~').ledge(21, 24, 9, '~').ent('A', 7, 13, FERRY(0, -7, 3.2)),
    new Room('Crumble Run', 'A long crumbling bridge to a spring, and a second, higher one beyond it.', 54)
      .pit(4, 49).ledge(4, 20, 12, '~').floor(22, 23, 12).put(22, 12, '*').put(23, 12, '*').ledge(26, 45, 7, '~').floor(47, 53, 9),
    new Room('Long Climb', 'A floaty climb up crumbling steps and back down to the moon rest.', 52)
      .pit(4, 43).ledge(6, 9, 12, '~').ledge(14, 17, 9, '~').ledge(22, 25, 6, '~').ledge(30, 33, 8, '~').ledge(38, 41, 10, '~'),
    rest('Moon Rest', 'Calm air (and normal gravity again) at the end of zone 4.'),
  ],
};

// ---- Zone 5: Howling Hollow ----------------------------------------------------------------
// Purple Panic in a gale: saws on quicker rails, belts that fight the crowd, and gusts that
// stack on top of the belts. Signature: "Saw Gate Gale".
const howlingHollow: Zone = {
  name: 'Howling Hollow', sky: 'purple', rooms: [
    new Room('Gale Saw', 'A saw bobbing in a gap while a headwind gusts: cross on its beat, in the lull.', 28)
      .pit(12, 14).ent('A', 13, 12, SAW({ dy: -5, period: 2 })).ent('W', 2, 5, W(-2.5, 3, { w: 24, h: 8, gustS: 1.2 })),
    new Room('Treadmill Gale', 'A backwards belt and a headwind together: push right with everything, hop the spikes in the lulls.', 40)
      .ledge(4, 35, 13, '<').spikes(15, 15).spikes(25, 25).ent('W', 2, 5, W(-2.5, 3, { w: 36, h: 8, gustS: 1.4 })),
    new Room('Patrol', 'A quick saw patrolling flat ground: slip past when it turns, or hop it.', 30)
      .ent('A', 8, 12, SAW({ dx: 12, period: 2.6 })),
    new Room('Saw Patrol Two', 'Two quick saws passing each other on a long floor.', 32)
      .ent('A', 6, 12, SAW({ dx: 12, period: 3 })).ent('B', 26, 12, SAW({ dx: -12, period: 3, phase: 0.25 })),
    new Room('Treadmill Saws', 'A backwards belt with saws dipping into it.', 32)
      .ledge(3, 28, 13, '<').ent('A', 10, 8, SAW({ dy: 3, period: 1.8 })).ent('B', 20, 8, SAW({ dy: 3, period: 1.8, phase: 0.5 })),
    new Room('Saw Gate Gale', 'A belt and a tailwind rush the blob toward a saw guarding a doorway: hold back, then dash.', 34)
      .ledge(3, 22, 13, '>').block(24, 28, 0, 8).ent('A', 26, 9, SAW({ dy: 3, period: 2 })).ent('W', 3, 6, W(2.5, 3, { w: 21, h: 7, gustS: 1.4 })),
    new Room('Night Ferry', 'A quick ferry over a pit with a saw sweeping above it.', 30)
      .pit(6, 21).ent('A', 6, 13, FERRY(9, 0, 3)).ent('B', 8, 10, SAW({ dx: 8, period: 2.2 })),
    new Room('Saw Corridor', 'Three saws bobbing in a row of 3-wide gaps, a beat apart.', 34)
      .pit(8, 10).pit(16, 18).pit(24, 26)
      .ent('A', 9, 12, SAW({ dy: -5, period: 1.9 })).ent('B', 17, 12, SAW({ dy: -5, period: 1.9, phase: 0.3 })).ent('C', 25, 12, SAW({ dy: -5, period: 1.9, phase: 0.6 })),
    new Room('Saw Lift', 'Ride a lift past a saw sweeping across the shaft.', 30)
      .pit(5, 9).floor(10, 29, 7).ent('A', 6, 13, FERRY(0, -6, 3.6)).ent('B', 5, 9, SAW({ dx: 3, period: 2.2 })),
    new Room('Conveyor Ferry', 'A forward belt that dumps the blob onto a ferry, if it is there.', 34)
      .ledge(3, 10, 13, '>').pit(11, 26).ent('A', 11, 13, FERRY(9, 0, 3.2)),
    new Room('Belt Maze', 'Belts that flip direction every few tiles, with spikes in between.', 40)
      .ledge(3, 7, 13, '>').spikes(8, 8).ledge(9, 13, 13, '<').spikes(14, 15).ledge(16, 20, 13, '>').ledge(21, 25, 13, '<').spikes(26, 26).ledge(27, 31, 13, '>').ledge(32, 36, 13, '<'),
    new Room('Ferry Saws', 'A ferry under two saws sweeping in opposite directions.', 32)
      .pit(5, 22).ent('A', 5, 13, FERRY(11, 0, 3.6)).ent('B', 8, 9, SAW({ dx: 6, period: 2.4 })).ent('C', 19, 9, SAW({ dx: -6, period: 2.4, phase: 0.5 })),
    new Room('Gust Garden', 'Saws on short rails at three heights while gusts swing the blob about.', 36)
      .ent('A', 8, 11, SAW({ dx: 4, period: 1.8 })).ent('B', 17, 9, SAW({ dy: 3, period: 1.4 })).ent('C', 26, 11, SAW({ dx: -4, period: 1.8, phase: 0.5 }))
      .ent('W', 2, 5, W(-3, 2.6, { w: 32, h: 8, gustS: 1 })),
    new Room('Saw Garden Two', 'A backwards belt under three saws on short rails: push, wait, dash.', 36)
      .ledge(3, 32, 13, '<').ent('A', 9, 10, SAW({ dy: 2, period: 1.6 })).ent('B', 18, 11, SAW({ dx: 4, period: 2 })).ent('C', 27, 10, SAW({ dy: 2, period: 1.6, phase: 0.5 })),
    new Room('Night Shift', 'Belts, presses and a saw in one long hall: the zone in miniature.', 42)
      .ledge(3, 12, 13, '<').ledge(26, 35, 13, '>').ent('A', 6, 5, PRESS(2.4)).ent('B', 17, 12, SAW({ dx: 5, period: 2 })).ent('C', 30, 5, PRESS(2.4, 0.5)),
    new Room('Gale Ferries', 'Two ferries with a saw bobbing on the island between them, in a gusting headwind.', 40)
      .pit(4, 15).floor(16, 20, 13).pit(21, 33).ent('A', 4, 13, FERRY(6, 0, 3.4)).ent('B', 18, 8, SAW({ dy: 3, period: 2 })).ent('C', 21, 13, FERRY(7, 0, 3.4, 0.5))
      .ent('W', 2, 5, W(-2, 2.8, { w: 36, h: 8, gustS: 1.1 })),
    new Room('Saw Gate Two', 'A backwards belt and a headwind toward a saw gate: here you must push hard to make the window.', 34)
      .ledge(3, 22, 13, '<').block(24, 28, 0, 8).ent('A', 26, 9, SAW({ dy: 3, period: 2.2 })).ent('W', 3, 6, W(-2, 3, { w: 21, h: 7, gustS: 1.4 })),
    new Room('Belt Steps', 'Stairs of forward belts that fling the blob at spikes.', 36)
      .floor(4, 10, 12).ledge(4, 10, 12, '>').floor(11, 17, 10).ledge(11, 17, 10, '>').spikes(16, 16, 9).floor(18, 24, 8).ledge(18, 23, 8, '>').spikes(24, 24, 7).pit(25, 27).floor(28, 35, 10),
    rest('Purple Rest', 'Calm air before the final zone.'),
  ],
};

// ---- Zone 6: Eye of the Storm --------------------------------------------------------------
// Everything at once, with a faster Big Chomp behind. Ends at the golden crown.
const eyeOfTheStorm: Zone = {
  name: 'Eye of the Storm', sky: 'purple', rooms: [
    new Room('Wake Up', 'The Big Chomp wakes up behind the blob, faster than last time: never stop.', 44)
      .ent('Z', 0, 0, { kind: 'chomp', speed: 3.6 }).pit(16, 18).spikes(25, 26).pit(33, 35),
    new Room('Chased Ferry', 'A fast ferry with no time to wait for it twice.', 26)
      .pit(6, 15).ent('A', 6, 13, FERRY(6, 0, 2.2)),
    new Room('Storm Presses', 'Three fast presses that never make you wait long.', 28)
      .ent('A', 5, 5, PRESS(1.4, 0, { holdS: 0.2, upS: 0.4 })).ent('B', 12, 5, PRESS(1.4, 0.33, { holdS: 0.2, upS: 0.4 })).ent('C', 19, 5, PRESS(1.4, 0.66, { holdS: 0.2, upS: 0.4 })),
    new Room('Tailwind Dash', 'Ride the gusts: a tailwind turns two 6-gaps into easy leaps, and helps outrun the teeth.', 44)
      .pit(10, 15).spikes(21, 22).pit(28, 33).ent('W', 2, 4, W(3, 2.4, { w: 36, h: 9, gustS: 1.4 })),
    new Room('Saw Run', 'Two quick saws patrolling ahead of the teeth.', 32)
      .ent('A', 6, 12, SAW({ dx: 10, period: 2 })).ent('B', 18, 12, SAW({ dx: 10, period: 2, phase: 0.5 })),
    new Room('Storm Ferry', 'A quick ferry into a gusting headwind, with the teeth behind.', 30)
      .pit(6, 19).ent('A', 6, 13, FERRY(7, 0, 2)).ent('W', 4, 5, W(-2, 2.4, { w: 18, h: 8, gustS: 1 })),
    new Room('Chomp Stairs', 'Crumbling stairs down into a saw pit, with the Chomp above.', 36)
      .pit(4, 22).ledge(4, 6, 12, '~').ledge(7, 9, 11, '~').ledge(10, 12, 10, '~').ledge(13, 15, 11, '~').ledge(16, 18, 12, '~').ledge(19, 21, 13, '~')
      .floor(23, 24, 13).pit(25, 27).ent('A', 26, 13, SAW({ dy: -4, period: 1.6 })),
    new Room('Belt Sprint', 'A forward belt into spike hops with a saw on patrol.', 36)
      .ledge(2, 33, 13, '>').spikes(9, 9).spikes(17, 18).spikes(27, 27).ent('A', 20, 9, SAW({ dx: 5, period: 1.6 })),
    new Room('Storm Press Ferry', 'A quick press, then a quick ferry, with the teeth closing in.', 36)
      .pit(12, 25).ent('A', 4, 5, PRESS(1.8, 0, { holdS: 0.3, upS: 0.6 })).ent('B', 12, 13, FERRY(9, 0, 2.2)),
    new Room('Needle Sprint', 'Two-wide pillars over the pit, hop hop hop, with a crosswind tugging back.', 36)
      .pit(4, 31).floor(7, 8, 12).floor(12, 13, 11).floor(17, 18, 12).floor(22, 23, 11).floor(27, 28, 12)
      .ent('W', 2, 4, W(-2, 2.2, { w: 30, h: 10, gustS: 0.9 })),
    new Room('Crumble Sprint', 'A crumbling bridge under ceiling spikes: short hops, no stopping.', 40)
      .pit(4, 35).ledge(4, 35, 13, '~').ceiling(8, 30, 8).spikes(15, 15).spikes(24, 24),
    new Room('Final Ferries', 'Two quick ferries out of step: no time to wait twice.', 40)
      .pit(5, 34).ent('A', 5, 13, FERRY(7, 0, 2.2)).ent('B', 18, 13, FERRY(7, 0, 2.2, 0.5)),
    new Room('Thorn Dash', 'A spiky ceiling over spikes while a tailwind gusts: short hops, with the wind and the teeth behind.', 44)
      .ceiling(6, 36, 8).spikes(11, 11).spikes(17, 18).spikes(25, 25).spikes(31, 32).ent('W', 4, 9, W(2.5, 2.4, { w: 34, h: 5, gustS: 1 })),
    new Room('Gust Crumble', 'A crumbling bridge with two gaps only a tailwind gust carries you over.', 40)
      .pit(4, 35).ledge(4, 13, 13, '~').ledge(19, 25, 13, '~').ledge(32, 35, 13, '~').ent('W', 2, 4, W(3, 2.2, { w: 36, h: 9, gustS: 1.2 })),
    new Room('Last Presses', 'Three quick presses before the final leap.', 28)
      .ent('A', 4, 5, PRESS(1.3, 0, { holdS: 0.2, upS: 0.4 })).ent('B', 10, 5, PRESS(1.3, 0.33, { holdS: 0.2, upS: 0.4 })).ent('C', 16, 5, PRESS(1.3, 0.66, { holdS: 0.2, upS: 0.4 })),
    new Room('The Eye', 'One last Big Press, then a tailwind leap over the final pit to the golden crown.', 32)
      .ent('A', 6, 5, PRESS(2.8, 0, { holdS: 0.8 })).pit(13, 18).block(30, 31, 0, 12).ent('W', 10, 4, W(3, 2.4, { w: 12, h: 9, gustS: 1.2 })),
  ],
};

const zones: Zone[] = [breezyBluffs, brambleGale, pistonworks, moonbounceMesa, howlingHollow, eyeOfTheStorm];

// The crown at the very end.
const last = zones[zones.length - 1]!.rooms;
last[last.length - 1]!.put(last[last.length - 1]!.w - 4, 12, 'G');

const HEADER = `/*
 * Level 2, hand-designed room by room (authored with tools/levelgen/level2.ts, which
 * emits this file: edit the generator, not this file). Legend as level 1: '#' solid,
 * '=' one-way ledge, '^' floor spike, 'v' ceiling spike, '~' crumble, '*' spring,
 * '>' '<' conveyors, '@' spawn, 'G' goal column, '.' empty. Ground sits at row 13.
 * New here: wind gusts (entity kind 'wind') and a low-gravity zone (zone gravity 0.6).
 * Every room has a comment saying what it asks of the crowd.
 */`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'shared', 'src', 'levels', 'level2.ts');
writeFileSync(out, levelTs({ id: 2, version: 1, exportName: 'LEVEL2', header: HEADER, zones }));
console.log('wrote', out, `(${zones.reduce((s, z) => s + z.rooms.reduce((a, r) => a + r.w, 0), 0)} columns)`);
