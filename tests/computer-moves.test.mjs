/**
 * Moves that are not there, on the data `npm run extract` and `npm run import` build: a cancel's
 * target id neither side's moveset has a move for (nor the default move it falls back to), which
 * the computer passes over as the fight does, as True Ogre's computer meets Nina's; and a knockout
 * that gave no reaction and opened no cancel, with no move chosen next to fall into.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { chooseMoves } from '../src/sim/fight/cancel.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.includes(14);
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const PAUL = 0;
const NINA = 5;
const JIN = 9;
const TRUE_OGRE = 20;
/** The round's flow while the fighters fight. */
const FIGHTING = 1;
/** The pad's directions, then its buttons. */
const BITS = [0x1000, 0x2000, 0x4000, 0x8000, 0x80, 0x10, 0x40, 0x20];

async function loadAll() {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const fightData = (setup) => {
    matchMovesets(tables, setup);
    return fightDataFor(tables, setup, (id) => movesets.get(id), common);
  };
  return { tables, scenes, fightData };
}

test("True Ogre's computer passes over a cancel to a move id neither his moveset nor Nina's has", { skip }, async () => {
  const { tables, scenes, fightData } = await loadAll();
  const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  Object.assign(state.entrants, { roster: [NINA, state.entrants.roster[1]], costume: [0, 0], chosen: [1, 0], computer: [0, 0] });
  state.world.match.stage = 9;
  state.modeOverlay = state.run.overlay;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  /* The pads a run that met the move pressed: a direction and a button now and then, from a fixed seed. */
  let seed = 1308;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16);
  let pad = 0;
  let full = null;
  let againstTrueOgre = 0;
  for (let field = 0; field < 20000 && againstTrueOgre <= 1600; field += 1) {
    const world = state.world;
    const fighting = state.scene === Scene.FIGHT && state.step === FightStep.FIGHTING && world.round.flow === FIGHTING;
    /* Ogre loses his first round, so he changes; Nina is kept standing against True Ogre. */
    if (fighting && world.fighters[1].roster !== TRUE_OGRE && 60 < world.round.frames && world.match.ogreChanged === 0) world.fighters[world.match.computerSide].health = 0;
    if (fighting && world.fighters[1].roster === TRUE_OGRE) {
      againstTrueOgre += 1;
      full ??= [world.fighters[0].health, world.fighters[1].health];
      for (const k of [0, 1]) if (world.fighters[k].health < full[k] / 2) world.fighters[k].health = full[k];
    }
    if (field % 5 === 0) pad = (rnd() & 1 ? BITS[rnd() % 4] : 0) | (rnd() % 3 === 0 ? BITS[4 + (rnd() % 4)] : 0);
    game.field([pad, 0]);
  }
  assert.ok(1488 < againstTrueOgre, `fought True Ogre past the move (${againstTrueOgre} fields)`);
});

test('a knockout that gave no reaction and opened no cancel has no move to fall into', { skip }, async () => {
  const { fightData } = await loadAll();
  const setup = { stage: 0, entrants: [{ roster: PAUL, costume: 0, computer: false }, { roster: JIN, costume: 0, computer: false }] };
  const data = fightData(setup);
  const fight = Fight.quick(data, setup);
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  const jin = fight.state.fighters[1];
  let none = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    fight.field([0, 0]);
    Object.assign(jin, { health: 0, hitClean: 1, hitReacting: 0 });
    jin.next.move = null;
    jin.next.id = -1;
    chooseMoves(fight.state, data);
    if (jin.next.move === null) none += 1;
  }
  assert.ok(0 < none, 'frames with no move chosen next');
});
