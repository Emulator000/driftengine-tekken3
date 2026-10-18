/**
 * Reachable walls: a square 9.6 m from the middle each way, a fighter's root held 0.4 m inside it,
 * root and position alike; a push into the wall moves the one pushing; none with the walls off, nor
 * in Tekken Ball or Tekken Force. Synthetic states; a fight on the imported data for a throw carried
 * to the wall and the scenery left unturned.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { blankFightState } from '../src/sim/fight/blank.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { Mode } from '../src/sim/fight/state.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode, wallsFor } from '../src/sim/game/menu.ts';
import { hitReaction } from '../src/sim/fight/cancel.ts';
import { resetFighter } from '../src/sim/fight/start.ts';
import { BODY, holdAtWalls, passWallPush, SPLAT_HITS, SPLAT_MOVE, WALL_REACH, wallSplats } from '../src/sim/fight/walls.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const LIMIT = WALL_REACH - BODY;

/** A Versus fight's state with the walls on (or as `walls` says), its first fighter's root and position at `root` (x, z) and `position`. */
function standing({ walls = 1, mode = Mode.VERSUS, root = [0, 0], position = root } = {}) {
  const state = blankFightState();
  state.mode = mode;
  state.options.walls = walls;
  const f = state.fighters[0];
  f.skeleton.base.translation[0] = root[0];
  f.skeleton.base.translation[2] = root[1];
  f.position[0] = position[0];
  f.position[2] = position[1];
  return { state, f };
}

test('a fighter past the wall is held inside it, its root and position moved alike, and how far the wall took it kept', () => {
  assert.equal(WALL_REACH, 9600);
  assert.equal(BODY, 400);
  const { state, f } = standing({ root: [12000, -2000], position: [11500, -1800] });
  holdAtWalls(state, f);
  assert.deepEqual([f.skeleton.base.translation[0], f.skeleton.base.translation[2]], [LIMIT, -2000]);
  assert.deepEqual([f.position[0], f.position[2]], [11500 - (12000 - LIMIT), -1800], 'the motion offset kept between them');
  assert.equal(f.wallHit, 12000 - LIMIT, 'how far the wall took it');
  const deep = standing({ root: [1000, -15000] });
  holdAtWalls(deep.state, deep.f);
  assert.deepEqual([deep.f.skeleton.base.translation[0], deep.f.skeleton.base.translation[2]], [1000, -LIMIT], 'the other wall alike');
  const inside = standing({ root: [LIMIT, -3000] });
  holdAtWalls(inside.state, inside.f);
  assert.deepEqual([inside.f.skeleton.base.translation[0], inside.f.skeleton.base.translation[2]], [LIMIT, -3000], 'a fighter at the wall stays');
  assert.equal(inside.f.wallHit, 0);
});

test('walls off plays as before', () => {
  const { state, f } = standing({ walls: 0, root: [12000, 0] });
  holdAtWalls(state, f);
  assert.equal(f.skeleton.base.translation[0], 12000);
  assert.equal(f.position[0], 12000);
  assert.equal(f.wallHit, 0);
});

test('Tekken Ball and Tekken Force keep their own bounds', () => {
  for (const mode of [Mode.TEKKEN_BALL, Mode.TEKKEN_FORCE]) {
    const { state, f } = standing({ mode, root: [12000, 0] });
    holdAtWalls(state, f);
    assert.equal(f.skeleton.base.translation[0], 12000, `mode ${mode}`);
  }
});

test('a push into the wall moves the one pushing, by as much as the wall took back', () => {
  const state = blankFightState();
  state.mode = Mode.VERSUS;
  state.options.walls = 1;
  const [a, b] = state.fighters;
  /* The push apart has just put the second 300 mm past the wall, pushing it away from the first. */
  for (const [f, x] of [
    [a, 8600],
    [b, LIMIT + 300],
  ]) {
    f.skeleton.base.translation[0] = x;
    f.position[0] = x;
  }
  b.push[0] = 300;
  b.pushed = 1;
  a.push[0] = -100;
  a.pushed = 1;
  passWallPush(state, a, b);
  assert.equal(b.skeleton.base.translation[0], LIMIT);
  assert.equal(b.position[0], LIMIT);
  assert.equal(a.skeleton.base.translation[0], 8300, 'the first moved back as far');
  assert.equal(a.position[0], 8300);
});

test('a fighter past the wall on its own, pushed by nobody this frame, is left to the next pose', () => {
  const state = blankFightState();
  state.mode = Mode.VERSUS;
  state.options.walls = 1;
  const [a, b] = state.fighters;
  b.skeleton.base.translation[0] = LIMIT + 300;
  b.position[0] = LIMIT + 300;
  /* A push left from an earlier frame, which this one did not make. */
  b.push[0] = 300;
  b.pushed = 0;
  a.skeleton.base.translation[0] = 0;
  passWallPush(state, a, b);
  assert.equal(a.skeleton.base.translation[0], 0, 'the other not moved');
});

async function fightOf(setup) {
  const { tables } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  matchMovesets(tables, setup);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), common);
  return { data, fight: Fight.quick(data, setup) };
}

const PAUL = 0;
const JIN = 9;
const RIGHT = 0x2000;
const UP = 0x1000;
const PUNCH = 0x80;
const KICK = 0x40;

test('with the walls on, a fighter walked into the wall stops at it, and the scenery does not turn', { skip }, async () => {
  const setup = { stage: 0, entrants: [{ roster: PAUL, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  const { fight } = await fightOf(setup);
  fight.state.options.walls = 1;
  const [paul, jin] = fight.state.fighters;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  /* Jin walks back, away from Paul, for twenty seconds, and Paul after him (two fighters are kept within 7.7 m), sidestepping now and then, turning the camera. */
  let most = 0;
  for (let field = 0; field < 1200; field += 1) {
    fight.field([field % 90 < 10 ? UP : RIGHT, RIGHT]);
    for (const f of [paul, jin]) most = Math.max(most, Math.abs(f.skeleton.base.translation[0]), Math.abs(f.skeleton.base.translation[2]));
    assert.equal(fight.state.scenery.yaw, 0, `field ${field}: the scenery unturned`);
  }
  assert.ok(most <= LIMIT, `no root past the wall (${most})`);
  assert.ok(most >= LIMIT - 200, `Jin reached the wall (${most})`);
});

test('a throw at the wall keeps both fighters inside it', { skip }, async () => {
  const setup = { stage: 0, entrants: [{ roster: PAUL, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  const { fight } = await fightOf(setup);
  fight.state.options.walls = 1;
  const [paul, jin] = fight.state.fighters;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  /* Jin backed to the wall, Paul in front of him. */
  for (let field = 0; field < 1200 && Math.abs(jin.skeleton.base.translation[0]) < LIMIT - 50 && Math.abs(jin.skeleton.base.translation[2]) < LIMIT - 50; field += 1) fight.field([RIGHT, RIGHT]);
  assert.ok(Math.max(Math.abs(jin.skeleton.base.translation[0]), Math.abs(jin.skeleton.base.translation[2])) >= LIMIT - 50, 'Jin at the wall');
  let most = 0;
  for (let round = 0; round < 6; round += 1) {
    for (let field = 0; field < 4; field += 1) fight.field([PUNCH | KICK, 0]);
    for (let field = 0; field < 150; field += 1) {
      fight.field([0, 0]);
      for (const f of [paul, jin]) most = Math.max(most, Math.abs(f.skeleton.base.translation[0]), Math.abs(f.skeleton.base.translation[2]));
    }
  }
  assert.ok(most <= LIMIT, `no root past the wall (${most})`);
});

const DOWN = 0x4000;
const RP = 0x10;
const LP = 0x80;
const JAB = [[LP, 2]];
/** Paul's Deathfist: down, down-forward, forward with the right punch, his hit that knocks a fighter farthest back. */
const DEATHFIST = [
  [DOWN, 3],
  [DOWN | RIGHT, 3],
  [RIGHT | RP, 3],
];

/** Paul and Jin on stage 0 with the walls on, Jin backed to the wall and Paul in front of him, a moment's rest after. */
async function atTheWall() {
  const setup = { stage: 0, entrants: [{ roster: PAUL, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  const { data, fight } = await fightOf(setup);
  fight.state.options.walls = 1;
  const [paul, jin] = fight.state.fighters;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  const out = () => Math.max(Math.abs(jin.skeleton.base.translation[0]), Math.abs(jin.skeleton.base.translation[2]));
  for (let field = 0; field < 1200 && out() < LIMIT - 50; field += 1) fight.field([RIGHT, RIGHT]);
  for (let field = 0; field < 30; field += 1) fight.field([0, 0]);
  assert.ok(out() >= LIMIT - 50, 'Jin at the wall');
  return { data, fight, paul, jin, out };
}

/** Paul's pads played, then `fields` more with none, Jin's own held throughout (crouching, down, takes a mid clean); Jin's moves meanwhile, and whether he was splatted. */
function play(fight, jin, pads, fields = 120, jinPad = 0) {
  for (const [pad, n] of pads) for (let k = 0; k < n; k += 1) fight.field([pad, jinPad]);
  const moves = [];
  let splatted = false;
  for (let field = 0; field < fields; field += 1) {
    fight.field([0, jinPad]);
    moves.push(jin.moveId);
    if (jin.splatted !== 0) splatted = true;
  }
  return { moves, splatted };
}

test('a light hit into the wall only pins: no splat, the fighter held at the wall', { skip }, async () => {
  const { fight, jin, out } = await atTheWall();
  const { moves, splatted } = play(fight, jin, JAB);
  assert.equal(splatted, false);
  assert.ok(!moves.includes(SPLAT_MOVE), 'no crumple');
  assert.ok(out() <= LIMIT);
});

test('a hard hit into the wall splats: the crumple against it, its knockback stopped', { skip }, async () => {
  const { fight, jin, out } = await atTheWall();
  const { moves, splatted } = play(fight, jin, DEATHFIST, 120, DOWN);
  assert.equal(splatted, true);
  assert.ok(moves.includes(SPLAT_MOVE), 'the crumple played');
  assert.ok(out() <= LIMIT);
});

test('a launch into the wall drops down it: its drift stopped, the fighter falling where it met the wall', { skip }, async () => {
  const { data, fight, paul, jin, out } = await atTheWall();
  /* Jin launched away from Paul, toward the wall, as a knockout's fall launches a fighter. */
  Object.assign(jin, { inAir: 1, guarded: 0, hitClean: 1, guard: 0 });
  hitReaction(data, jin, paul);
  jin.transition = 1;
  let splatted = false;
  let wasAirborne = false;
  for (let field = 0; field < 90; field += 1) {
    fight.field([0, 0]);
    if (jin.inArc !== 0) wasAirborne = true;
    if (jin.splatted !== 0) splatted = true;
  }
  assert.ok(wasAirborne, 'launched');
  assert.equal(splatted, true, 'splatted in the air');
  assert.ok(out() <= LIMIT);
  assert.equal(jin.inArc, 0, 'down again');
});

/** Every field Jin goes from not splatted to splatted, over `pads` then `fields` more fields (Jin's own pad `jinPad`). */
function splats(fight, jin, pads, fields = 150, jinPad = 0) {
  let count = 0;
  let was = jin.splatted !== 0;
  const step = (pad) => {
    fight.field([pad, jinPad]);
    const now = jin.splatted !== 0;
    if (now && !was) count += 1;
    was = now;
  };
  for (const [pad, n] of pads) for (let k = 0; k < n; k += 1) step(pad);
  for (let field = 0; field < fields; field += 1) step(0);
  return count;
}

test('a splat once in a combo, and again once the fighter is back on its feet', { skip }, async () => {
  const { fight, jin } = await atTheWall();
  assert.equal(splats(fight, jin, DEATHFIST, 20, DOWN), 1, 'the first');
  assert.equal(splats(fight, jin, DEATHFIST, 20, DOWN), 0, 'not again in the same combo');
  /* Jin left to fall and get up (pressing up to rise), then a rest. */
  for (let field = 0; field < 400 && jin.splatted !== 0; field += 1) fight.field([0, field % 20 < 2 ? UP : 0]);
  for (let field = 0; field < 60; field += 1) fight.field([0, 0]);
  assert.equal(jin.splatted, 0, 'recovered');
  for (let field = 0; field < 20; field += 1) fight.field([0, DOWN]);
  assert.equal(splats(fight, jin, DEATHFIST, 20, DOWN), 1, 'splatted anew');
});

test('the third clean hit after a splat makes the fighter fall, as a knockout falls', { skip }, async () => {
  const { data, fight, jin } = await atTheWall();
  assert.equal(splats(fight, jin, DEATHFIST, 20, DOWN), 1);
  const launches = new Set(data.reactions.launches.map((launch) => launch.move));
  /* A frame in which the splatted Jin takes a clean hit, with two taken already: the third. */
  Object.assign(jin, { splatHits: SPLAT_HITS - 1, hitReacting: 1, guarded: 0, inArc: 0 });
  jin.next.move = null;
  jin.next.id = -1;
  wallSplats(fight.state, data);
  assert.ok(launches.has(jin.next.id), `a launch chosen next (${jin.next.id.toString(16)})`);
  assert.equal(jin.inAir, 1);
  /* A second hit (splatted anew) leaves it as it was. */
  Object.assign(jin, { splatted: 1, splatHits: SPLAT_HITS - 3, hitReacting: 1, guarded: 0, inAir: 0 });
  jin.next.move = null;
  jin.next.id = -1;
  wallSplats(fight.state, data);
  assert.equal(jin.next.move, null, 'no move chosen for it');
  assert.equal(jin.splatHits, SPLAT_HITS - 2);
});

test("each mode's walls: none in Tekken Ball, Tekken Force or the demo; online (the waiting room too) unless the setting is OFF; offline only where it is ON", () => {
  const ONLINE_ONLY = 0;
  const ON = 1;
  const OFF = 2;
  for (const mode of [MenuMode.TEKKEN_BALL, MenuMode.TEKKEN_FORCE, MenuMode.DEMO]) {
    for (const setting of [ONLINE_ONLY, ON, OFF]) for (const online of [false, true]) assert.equal(wallsFor(mode, setting, online), 0, `mode ${mode}`);
  }
  for (const mode of [MenuMode.ARCADE, MenuMode.VERSUS, MenuMode.TEAM_BATTLE, MenuMode.TIME_ATTACK, MenuMode.SURVIVAL, MenuMode.PRACTICE]) {
    assert.equal(wallsFor(mode, ONLINE_ONLY, false), 0, `mode ${mode} offline, online only`);
    assert.equal(wallsFor(mode, ON, false), 1, `mode ${mode} offline, on`);
    assert.equal(wallsFor(mode, OFF, false), 0, `mode ${mode} offline, off`);
    assert.equal(wallsFor(mode, ONLINE_ONLY, true), 1, `mode ${mode} online, online only`);
    assert.equal(wallsFor(mode, ON, true), 1, `mode ${mode} online, on`);
    assert.equal(wallsFor(mode, OFF, true), 0, `mode ${mode} online, off`);
  }
});

test("a mode started from the menu takes its walls from REACHABLE WALLS; a quick match's from its setup, none by default", { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => null });
  for (const [setting, mode, walls] of [
    [1, MenuMode.ARCADE, 1],
    [0, MenuMode.ARCADE, 0],
    [1, MenuMode.TEKKEN_FORCE, 0],
    [1, MenuMode.PRACTICE, 1],
    [2, MenuMode.VERSUS, 0],
  ]) {
    game.state.remake.settings.walls = setting;
    startMode(game.state, mode, 1);
    assert.equal(game.state.world.options.walls, walls, `setting ${setting}, mode ${mode}`);
  }
  const setup = { stage: 0, entrants: [{ roster: PAUL, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  assert.equal((await fightOf(setup)).fight.state.options.walls, 0);
  assert.equal((await fightOf({ ...setup, walls: 1 })).fight.state.options.walls, 1);
});

test("the walls' corners are cut: a root is held inside the eight sides, each the same distance from the middle", () => {
  const { state, f } = standing({ root: [9000, 9000] });
  holdAtWalls(state, f);
  const [x, z] = [f.skeleton.base.translation[0], f.skeleton.base.translation[2]];
  assert.ok(Math.abs(x) + Math.abs(z) <= Math.floor(LIMIT * Math.SQRT2), `inside the corner's side (${x}, ${z})`);
  assert.ok(Math.abs(x) + Math.abs(z) >= Math.floor(LIMIT * Math.SQRT2) - 2, 'held at it, not short of it');
  assert.equal(x, z, 'straight back from the corner');
  assert.ok(f.wallHit > 0);
});

test('a blocked hard hit at the wall does not splat: the blocker is pinned, not crumpled', { skip }, async () => {
  const { fight, jin } = await atTheWall();
  let guarded = false;
  let splatted = false;
  const moves = [];
  for (const [pad, n] of DEATHFIST) for (let k = 0; k < n; k += 1) fight.field([pad, RIGHT]);
  for (let field = 0; field < 80; field += 1) {
    fight.field([0, RIGHT]);
    if (jin.guarded !== 0) guarded = true;
    if (jin.splatted !== 0) splatted = true;
    moves.push(jin.moveId);
  }
  assert.ok(guarded, 'Jin blocked it, holding back');
  assert.equal(splatted, false, 'no splat');
  assert.ok(!moves.includes(SPLAT_MOVE), 'no crumple');
});

test("a round starts with no fighter splatted, whatever the last round's end left", { skip }, async () => {
  const { data, fight, paul, jin } = await atTheWall();
  Object.assign(jin, { splatted: 1, splatHits: SPLAT_HITS, carried: 900, wallHit: 120 });
  resetFighter(fight.state, data, jin, paul);
  assert.deepEqual([jin.splatted, jin.splatHits, jin.carried, jin.wallHit], [0, 0, 0, 0]);
});

test('after a splat the fall comes only with a clean hit on the ground, and once: none without a hit, none in the air, none after it', { skip }, async () => {
  const { data, fight, jin } = await atTheWall();
  assert.equal(splats(fight, jin, DEATHFIST, 20, DOWN), 1);
  const launches = new Set(data.reactions.launches.map((launch) => launch.move));
  const frame = (fields) => {
    Object.assign(jin, fields);
    jin.next.move = null;
    jin.next.id = -1;
    wallSplats(fight.state, data);
  };
  frame({ splatted: 1, splatHits: SPLAT_HITS, hitReacting: 0, inArc: 0 });
  assert.equal(jin.next.move, null, 'no hit this frame: no fall');
  frame({ splatted: 1, splatHits: SPLAT_HITS - 1, hitReacting: 1, guarded: 0, inArc: 1 });
  assert.equal(jin.next.move, null, 'the third hit in the air: no fall');
  assert.equal(jin.splatted, 2, 'counted out all the same');
  frame({ splatHits: 0, hitReacting: 1, guarded: 0, inArc: 0, inAir: 0 });
  assert.equal(jin.next.move, null, 'counted out: no fall for the rest of the combo');
  frame({ splatted: 1, splatHits: SPLAT_HITS - 1, hitReacting: 1, guarded: 0, inArc: 0, inAir: 0 });
  assert.ok(launches.has(jin.next.id), 'the third clean hit on the ground: the fall');
  assert.equal(jin.splatted, 2, 'once a combo');
});
