/**
 * Tekken Ball on the imported data: the first player to choose a character chooses the ball on the
 * versus select (left slides the next one in, a button takes it) and the match is on the beach
 * against Gon the first time; in the fight the ball fades in over the server's half and hovers, a
 * point takes thirty health from the side it fell on, an attack's touch charges it by the move's
 * damage, and the charged ball strikes the other side, the toucher's copy leaving the moves' tables
 * as they were; the knockout replays the ball's last frames twice before the closing.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { BallStep } from '../src/sim/fight/ball.ts';
import { fightDataFor } from '../src/sim/fight/match.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { VsSideState } from '../src/sim/game/vs-select.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.length > 0;
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const PAD = { right: 0x2000, down: 0x4000, left: 0x8000, square: 0x80, triangle: 0x10, circle: 0x20 };
const POINT = 30 << 16;

/** A game in Tekken Ball, one human on the first pad, every character earned, at the versus select's first field of choosing. */
async function ball() {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const loaded = { data: null };
  const game = new Game({ tables, scenes, fightData: (setup) => (loaded.data = fightDataFor(tables, setup, (id) => movesets.get(id), common)), introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.records.earnedRoster = 0x1fffff;
  startMode(state, MenuMode.TEKKEN_BALL, 1);
  state.options.lastChoices.fill(0xfc);
  for (let field = 0; field < 200 && !(state.scene === Scene.VS_SELECT && state.step === 2); field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VS_SELECT, 'Tekken Ball chooses on the versus select');
  return { game, state, tables, loaded };
}

/** The first pad's buttons pressed for a field, then let go for one. */
function press(game, pad) {
  game.field([pad, 0]);
  game.field([0, 0]);
}

/** The ball's choice made (`lefts` slides to the left) and the select left; on to the fight's first live frame. */
async function toFight(lefts = 0) {
  const t = await ball();
  const { game, state } = t;
  press(game, PAD.square);
  for (let k = 0; k < lefts; k += 1) {
    press(game, PAD.left);
    for (let field = 0; field < 40; field += 1) game.field([0, 0]);
  }
  for (let field = 0; field < 40; field += 1) game.field([0, 0]);
  press(game, PAD.square);
  for (let field = 0; field < 600 && !(state.scene === Scene.FIGHT && state.world.round.number === 1); field += 1) game.field([0, 0]);
  return t;
}

test('the first to choose a character chooses the ball, and the match is on the beach against Gon', { skip }, async () => {
  const { game, state, tables } = await ball();
  const side = state.vsSelect.sides[0];
  press(game, PAD.square);
  assert.equal(side.state, VsSideState.BALL_CHOICE, 'the first to choose chooses the ball');
  assert.equal(state.world.match.ball.server, 0, 'and is served from');
  for (let field = 0; field < 40; field += 1) game.field([0, 0]);
  assert.ok(state.printed.some((run) => run.text === 'BEACH BALL'), 'the ball shown by its name');
  press(game, PAD.left);
  for (let field = 0; field < 40; field += 1) game.field([0, 0]);
  assert.equal(state.world.match.ball.kind, 1, 'left brings the next one in');
  assert.ok(state.printed.some((run) => run.text === 'GUM BALL'));
  press(game, PAD.square);
  assert.equal(side.state, VsSideState.BALL_WAIT, 'a button takes it');
  for (let field = 0; field < 200 && state.scene !== Scene.VERSUS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VERSUS);
  assert.equal((state.entrants.roster[1] << 2) | state.entrants.costume[1], 0x44, 'Gon the first time');
  assert.equal(state.records.extraDrawn, 1);
  assert.equal(state.world.stage, 0x13, 'the beach');
  assert.equal(state.world.stageSong, tables.roster.codes[0x44].song, "the opponent's song");
  for (let field = 0; field < 4; field += 1) game.field([0, 0]);
  assert.ok(state.versus.records.some((r) => r.kind === 'text' && r.text === 'TEKKEN BALL'));
});

test('select on the ball goes back to choosing the character, and nobody chooses the ball', { skip }, async () => {
  const { game, state } = await ball();
  press(game, PAD.square);
  for (let field = 0; field < 40; field += 1) game.field([0, 0]);
  press(game, 0x100);
  assert.equal(state.vsSelect.sides[0].state, VsSideState.CHOOSING);
  assert.equal(state.run.ball.choosing, 0);
  assert.equal(state.vsSelect.sides[0].count, 0);
});

test('a round: the ball fades in over the server\'s half and hovers, and a point takes thirty from the side it fell on', { skip }, async () => {
  const { game, state } = await toFight();
  const world = state.world;
  const b = world.ball;
  assert.equal(b.state, BallStep.OPENING);
  assert.equal(b.position[0], -0xd00, "over the server's half");
  let hovered = false;
  let point = 0;
  const before = [world.fighters[0].health, world.fighters[1].health];
  for (let field = 0; field < 3000 && point === 0; field += 1) {
    game.field([0, 0]);
    hovered ||= b.state === BallStep.HOVER;
    if (b.pointAgainst !== 0) point = b.pointAgainst;
  }
  assert.ok(hovered, 'hovering to be served');
  assert.notEqual(point, 0, 'a point');
  const side = point - 1;
  assert.equal(world.fighters[side].health, before[side] - POINT, 'thirty from its side');
  assert.equal(b.charge[side], 0, 'its charge gone');
  for (let field = 0; field < 40 && b.state !== BallStep.CENTRE; field += 1) game.field([0, 0]);
  assert.equal(b.state, BallStep.CENTRE, 'the ball back over the centre');
  assert.equal(b.position[0], 0);
});

test("an attack's touch charges the ball by the move's damage, and the charged ball strikes the other side", { skip }, async () => {
  const { game, state, loaded } = await toFight();
  const world = state.world;
  const b = world.ball;
  const ids = () => JSON.stringify(loaded.data.moveIds.map((table) => table.map((m) => (m === null ? null : [m.set, m.index]))));
  const before = ids();
  let touches = 0;
  let charged = null;
  let struck = false;
  for (let field = 0; field < 8000 && state.scene === Scene.FIGHT && !(charged !== null && struck && touches >= 20); field += 1) {
    const ax = world.fighters[0].skeleton.base.translation[0];
    const gap = b.position[0] - ax;
    let pad = 0;
    if (gap > 1150) pad = PAD.right;
    else if (gap < 700) pad = PAD.left;
    else if (b.position[1] > -1600 && field % 8 === 0) pad = [PAD.square, PAD.triangle, PAD.down | PAD.right | PAD.triangle, PAD.circle][(field >> 3) % 4];
    const cooling = b.cooldown;
    game.field([pad, 0]);
    if (b.cooldown === 5 && cooling !== 5) touches += 1;
    if (charged === null && b.cooldown === 5 && b.power !== 0) charged = { side: b.lastHitter, power: b.power, charge: b.charge[b.lastHitter] };
    struck ||= b.struck !== 0;
  }
  assert.ok(touches >= 20, `${touches} touches`);
  assert.equal(ids(), before, "the toucher's copy shares the moves it plays, writing nothing into them");
  assert.ok(charged !== null, 'a touch charged the ball');
  assert.equal(charged.power, charged.charge, "the ball carries its side's charge");
  assert.ok(struck, 'the charged ball struck a fighter');
});

test('the knockout replays the ball twice before the closing', { skip }, async () => {
  const { game, state } = await toFight();
  const world = state.world;
  const shown = new Set();
  let closed = false;
  for (let field = 0; field < 20000 && !closed; field += 1) {
    game.field([0, 0]);
    if (world.round.flow === 2) shown.add(world.match.ball.replaysShown);
    closed = world.round.flow === 6;
  }
  assert.ok(closed, 'the round closed');
  assert.ok(shown.has(1) && shown.has(2), 'two replays');
  assert.equal(world.match.ball.replaysWanted, 2);
});
