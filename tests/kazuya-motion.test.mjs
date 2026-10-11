/**
 * Kazuya's moves in the remake's fight, as `npm run extract` and `npm run import` build them: a
 * follow-up that Tekken 4 plays on the same motion carries the frame on, and one that Tekken 4 takes
 * by itself at a frame is taken, so his Spinning Demon plays its first kick through and then its
 * second, his body turning smoothly all the way; his whole body turns as Tekken 4's root does, and a
 * move that leaves him on the ground leaves him lying there.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { transitionType } from '../src/sim/fight/move.ts';
import { motionOf, moveById } from '../src/sim/fight/moves.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const kazuya = Array.isArray(manifest.movesets) && manifest.movesets.includes(15) && manifest.kazuya === true;
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const KAZUYA = 22;
const JIN = 9;
const PAD = { right: 0x2000, down: 0x4000, kick: 0x20 };
/** A cancel's type that starts its move at once. */
const AT_ONCE = 6;

/**
 * A quick match of Kazuya against Jin, stepped with `padAt(field)` for player 1, each field's fighter
 * state passed to `seen` after it, and `before` called before each.
 */
async function play(padAt, fields, seen, before = () => {}) {
  const setup = { stage: 0, entrants: [{ roster: KAZUYA, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  const { tables } = await loadFightTables(json);
  const [first, second] = matchMovesets(tables, setup);
  const [a, b, common] = await Promise.all([loadMoveset(json, two(first)), loadMoveset(json, two(second)), loadMoveset(json, 'common')]);
  const data = fightDataFor(tables, setup, (id) => (id === first ? a : b), common);
  const fight = Fight.quick(data, setup);
  for (let field = 0; field < fields; field += 1) {
    before(field, fight.state.fighters[0], data);
    fight.field([padAt(field), 0]);
    seen(field, fight.state.fighters[0], data, fight.state);
  }
}

/** A `before` for `play` that starts move `id` on field `at`, as a cancel taken at once would. */
const startAt = (id, at) => (field, f, data) => {
  if (field !== at) return;
  f.next.id = id;
  f.next.move = moveById(data, f, id);
  f.next.type = transitionType(data, f, AT_ONCE);
  f.next.turnAround = 0;
  f.next.noBlend = 0;
};

/** A motion by what it plays, so two copies of one compare alike. */
const same = (motion) => JSON.stringify({ frames: motion.frames, channels: motion.channels });

/** The angle in degrees between two 4.12 rotations. */
function turn(a, b) {
  let trace = 0;
  for (let i = 0; i < 9; i += 1) trace += (a[i] / 4096) * (b[i] / 4096);
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}

/** The crouch dash (forward, neutral, down, down-forward) and its d/f+4 from field 420, then 4 again `later` fields after. */
function spinningDemon(later) {
  const pads = new Map();
  [PAD.right, PAD.right, 0, 0, PAD.down, PAD.down, PAD.down | PAD.right, PAD.down | PAD.right, PAD.down | PAD.right | PAD.kick].forEach((pad, k) => pads.set(420 + k, pad));
  pads.set(428 + later, PAD.down | PAD.right | PAD.kick);
  return (field) => pads.get(field) ?? 0;
}

test('his Spinning Demon plays its first kick through into its second', { skip: !kazuya }, async () => {
  const played = [];
  await play(spinningDemon(8), 520, (field, f, data) => {
    if (field < 428) return;
    const last = played[played.length - 1];
    if (last === undefined || last.id !== f.moveId) played.push({ id: f.moveId, frame: f.frame, motion: same(motionOf(data, f.move)) });
  });
  const kick = played.findIndex((p) => p.id !== 105 && p.id !== 3);
  assert.ok(kick >= 0, 'the d/f+4 started a move');
  const [first, carried, second] = played.slice(kick);
  assert.ok(carried !== undefined && carried.motion === first.motion, 'the second 4 plays on the first kick');
  assert.ok(carried.frame > 1, `the first kick's frame carried on (it started on frame ${carried.frame})`);
  assert.ok(second !== undefined && second.motion !== first.motion, 'then the second kick plays');
});

/*
 * His body (chest and hips) turns at most about 40 degrees a field through the spin; a follow-up that
 * started the first kick over blended his hips half a turn back, 113 degrees in one field. The legs are
 * left out: the second kick's thigh turns 66 degrees in a field in Tekken 4's own motion.
 */
test('his body turns smoothly through the Spinning Demon', { skip: !kazuya }, async () => {
  const JOINTS = [1, 11];
  let previous = null;
  let worst = { by: 0, field: -1, joint: -1 };
  await play(spinningDemon(8), 520, (field, f) => {
    const now = JOINTS.map((j) => Array.from(f.skeleton.joints[j].world.rotation));
    if (field >= 428 && previous !== null) {
      JOINTS.forEach((joint, k) => {
        const by = turn(previous[k], now[k]);
        if (by > worst.by) worst = { by, field, joint };
      });
    }
    previous = now;
  });
  assert.ok(worst.by <= 45, `joint ${worst.joint} turned ${worst.by.toFixed(0)} degrees on field ${worst.field}`);
});

/*
 * Tekken 4 turns his whole body (its root) through some kicks, the hips turning over under a torso that
 * keeps facing the opponent; left out, the kick of move 361 went out 880 mm to his side.
 */
test('his turning high kick goes out toward the opponent', { skip: !kazuya }, async () => {
  const KICK = 361;
  const FEET = [14, 17];
  let highest = { height: 0, along: 0, across: 0 };
  let started = false;
  await play(
    () => 0,
    700,
    (field, f, data, state) => {
      if (f.moveId === KICK) started = true;
      if (!started || f.moveId !== KICK) return;
      const me = f.skeleton.base.translation;
      const them = state.fighters[1].skeleton.base.translation;
      const dx = them[0] - me[0];
      const dz = them[2] - me[2];
      const length = Math.hypot(dx, dz);
      for (const joint of FEET) {
        const t = f.skeleton.joints[joint].world.translation;
        const height = -t[1];
        if (height <= highest.height) continue;
        const x = t[0] - me[0];
        const z = t[2] - me[2];
        highest = { height, along: (x * dx + z * dz) / length, across: (z * dx - x * dz) / length };
      }
    },
    startAt(KICK, 440),
  );
  assert.ok(highest.height > 1000, `the kick rose (${highest.height.toFixed(0)} mm)`);
  assert.ok(Math.abs(highest.across) < highest.along, `at its highest the foot is ${highest.along.toFixed(0)} mm out and ${highest.across.toFixed(0)} mm to the side`);
});

/*
 * His Demon Scissors flips him through the air onto his front, his whole body turning as Tekken 4's
 * root does, and leaves him lying where Tekken 3's own Demon Scissors does (157), from the pose it
 * ends on; it handed him to his stance, standing him up in one field.
 */
test('his Demon Scissors lands him lying face down', { skip: !kazuya }, async () => {
  const FACE_DOWN = 157;
  const heihachi = (await loadMoveset(json, '13')).moveset;
  let scissors = -1;
  let handOff = null;
  let previous = null;
  let last = -1;
  await play(
    () => 0,
    700,
    (field, f) => {
      const now = [1, 11].map((j) => Array.from(f.skeleton.joints[j].world.rotation));
      if (previous !== null && last === scissors && f.moveId !== scissors) handOff = { to: f.moveId, by: Math.max(...now.map((r, k) => turn(previous[k], r))) };
      previous = now;
      last = f.moveId;
    },
    (field, f, data) => {
      if (field === 0) scissors = landsFaceDown(data, heihachi);
      if (scissors >= 0) startAt(scissors, 440)(field, f, data);
    },
  );
  assert.ok(scissors >= 0, 'one of his attacks ends lying face down');
  assert.equal(handOff?.to, FACE_DOWN, 'it went on to lying face down');
  assert.ok(handOff.by <= 15, `his body turned ${handOff.by.toFixed(0)} degrees as it did`);
});

/** His own attack, on an id Heihachi's file leaves empty, that ends lying face down. */
function landsFaceDown(data, heihachi) {
  const END = 0xc000;
  const ids = data.moveIds[0];
  for (let id = 0; id < ids.length; id += 1) {
    const ref = ids[id];
    if (ref === null || heihachi.moveIds[id] !== null) continue;
    const set = data.sets[ref.set].moveset;
    const move = set.moves[ref.index];
    if (move.hitLevel === 0) continue;
    let k = move.cancels;
    while (set.cancels[k].command !== END) k += 1;
    if (set.cancels[k].target === 157) return id;
  }
  return -1;
}

/*
 * His u+4 string: Tekken 4 plays each 4 that follows on from the frame the kick before is on, its
 * motion opening as the one before does, so the jump kick, the landing kick and the spin are one
 * motion. Started at their first frame, the second replayed the jump from its crouch, blending his
 * body half a turn round in a field on the way.
 */
test('his u+4 string plays on as one motion', { skip: !kazuya }, async () => {
  const UP = 0x1000;
  const pads = (field) => (field === 428 ? UP | PAD.kick : field > 428 && field < 520 ? (field % 2 === 0 ? PAD.kick : 0) | (field < 432 ? UP : 0) : 0);
  const moves = [];
  const JOINTS = [1, 11, 12, 15];
  let previous = null;
  let worst = 0;
  let stance = -1;
  await play(pads, 520, (field, f) => {
    if (field < 428) return;
    if (field === 428) stance = f.moveId;
    if (moves.length === 0 && f.moveId === stance) return;
    if (moves.at(-1)?.id !== f.moveId) moves.push({ id: f.moveId, frame: f.frame });
    const now = JOINTS.map((j) => Array.from(f.skeleton.joints[j].world.rotation));
    if (previous !== null && moves.length <= 2) worst = Math.max(worst, ...JOINTS.map((_, k) => turn(previous[k], now[k])));
    previous = now;
  });
  assert.ok(moves.length >= 3, `the string went on: ${JSON.stringify(moves)}`);
  assert.ok(moves[1].frame > 20, `the second kick took up the first's frame (it started on frame ${moves[1].frame})`);
  assert.ok(worst < 90, `his body turned ${worst.toFixed(0)} degrees in a field through the first two kicks`);
});

/*
 * His feet stand on the floor: in his stance Tekken 4 holds his ankles 94 to 101 mm up; his model
 * took Heihachi's size, which lowers the root alone by 2%, and they stood at 77 to 81.
 */
test('in his stance his ankles stand as high as Tekken 4 holds them', { skip: !kazuya }, async () => {
  let ankles = null;
  await play(
    () => 0,
    440,
    (field, f) => {
      if (field === 439) ankles = [14, 17].map((j) => -f.skeleton.joints[j].world.translation[1]);
    },
  );
  assert.ok(ankles.every((h) => h >= 90), `his ankles are ${ankles.join(' and ')} mm up`);
});
