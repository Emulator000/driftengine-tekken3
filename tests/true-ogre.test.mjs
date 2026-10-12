/**
 * True Ogre in the remake's fight and in Arcade, as `npm run extract` and `npm run import` build
 * them: he fights, his wings opening and beating while he is in the air and his stretched arm
 * lengthening the joints that beat; and in Arcade's last stage the first round won against Ogre
 * changes Ogre into True Ogre (start cutting the change short), the match going on against him
 * with the rounds won kept, through to the human's ending.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { OgreChangeShows } from '../src/sim/game/ogre-change.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.includes(14);
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const PAUL = 0;
const HEIHACHI = 13;
const JIN = 9;
const OGRE = 14;
const TRUE_OGRE = 20;
const START = 0x800;
/** The round's flow while the fighters fight. */
const FIGHTING = 1;

/** Every moveset the import wrote, and the match data for a setup from them. */
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

/** The length of a rotation's first column, in 4096ths. */
const columnLength = (m) => Math.hypot(m[0], m[3], m[6]);

test('True Ogre fights: his wings open and beat in the air, and his stretched arm lengthens the joints that beat', { skip }, async () => {
  const { fightData } = await loadAll();
  const setup = { stage: 6, entrants: [{ roster: PAUL, costume: 0, computer: true }, { roster: TRUE_OGRE, costume: 0, computer: true }] };
  const fight = Fight.quick(fightData(setup), setup);
  const ogre = fight.state.fighters[1];
  let beating = false;
  let stretched = null;
  for (let field = 0; field < 4000; field += 1) {
    const live = fight.state.round.flow === FIGHTING && fight.state.replay.state !== 1;
    if (stretched === null && live && 600 < field) {
      Object.assign(ogre.trueOgre, { arm: 0x100, armTarget: 0x100, armRate: 0 });
      fight.field([0, 0]);
      const locals = ogre.skeleton.locals;
      stretched = { along: columnLength(locals[0x12].rotation), shortened: columnLength(locals[6].rotation) };
      Object.assign(ogre.trueOgre, { arm: 0, armTarget: 0 });
      continue;
    }
    fight.field([0, 0]);
    if (ogre.trueOgre.wingState === 1) beating = true;
  }
  assert.ok(beating, 'his wings beat at some point');
  assert.ok(stretched !== null, 'a live frame to stretch his arm on');
  /* Joint 5 is placed by local 18, stretched along its bone by a quarter; joint 19 by local 6, shortened by it. */
  assert.ok(Math.abs(stretched.along - 0x1400) < 0x20, `the stretched joint is ${stretched.along.toFixed(0)} long, not 5120`);
  assert.ok(Math.abs(stretched.shortened - 0xc00) < 0x20, `the shortened joint is ${stretched.shortened.toFixed(0)} long, not 3072`);
});

/**
 * Arcade at its last stage for `roster` on the first pad, the computer's health taken a second
 * into each round so the human wins, `pads(field, game)` the first pad; the fight scene's states,
 * the change's fields and the fighters as they went.
 */
async function lastStage(roster, pads = () => 0) {
  const { tables, scenes, fightData } = await loadAll();
  const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  Object.assign(state.entrants, { roster: [roster, state.entrants.roster[1]], costume: [0, 0], chosen: [1, 0], computer: [0, 0] });
  state.world.match.stage = 9;
  state.modeOverlay = state.run.overlay;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  const seen = { steps: [], changeFields: 0, dressedAs: null, shows: new Set(), trueOgre: null };
  for (let field = 0; field < 4000 && state.scene !== Scene.MOVIE; field += 1) {
    const world = state.world;
    if (state.scene === Scene.FIGHT && state.step === FightStep.FIGHTING && world.round.flow === FIGHTING && 60 < world.round.frames) world.fighters[world.match.computerSide].health = 0;
    game.field([pads(field, game), 0]);
    if (state.scene !== Scene.FIGHT) continue;
    if (seen.steps.at(-1) !== state.step) seen.steps.push(state.step);
    if (state.step === FightStep.OGRE_CHANGING || state.step === FightStep.OGRE_CHANGED) {
      seen.changeFields += state.ogreChange.shows !== OgreChangeShows.NONE ? 1 : 0;
      seen.shows.add(state.ogreChange.shows);
      seen.dressedAs ??= world.fighters[0].roster;
    }
    if (seen.trueOgre === null && world.fighters[1].roster === TRUE_OGRE && state.step === FightStep.FIGHTING) {
      seen.trueOgre = { round: world.round.number, wins: [world.fighters[0].wins, world.fighters[1].wins], opponent: state.run.opponents[9].roster };
    }
  }
  return { state, seen };
}

test('in Arcade\'s last stage, a round won against Ogre changes him into True Ogre, and the match goes on to the ending', { skip }, async () => {
  const { state, seen } = await lastStage(PAUL);
  const change = [FightStep.OGRE_CHANGE, FightStep.OGRE_CHANGE_START, FightStep.OGRE_CHANGING, FightStep.OGRE_CHANGED, FightStep.TRUE_OGRE_SHOWN, FightStep.TRUE_OGRE, FightStep.HOLD];
  const at = seen.steps.indexOf(FightStep.OGRE_CHANGE);
  assert.ok(0 < at, 'Ogre changes');
  assert.deepEqual(seen.steps.slice(at, at + change.length), change, 'the change, then True Ogre\'s match with no versus screen');
  assert.equal(seen.changeFields, 263, 'its set-up\'s field of black, its camera\'s, 257 of its scene and four of white');
  assert.deepEqual([...seen.shows].sort(), [OgreChangeShows.BLACK, OgreChangeShows.SCENE, OgreChangeShows.WHITE]);
  assert.equal(seen.dressedAs, HEIHACHI, 'the human dressed as the ninth stage\'s boss');
  assert.deepEqual(seen.trueOgre, { round: 2, wins: [1, 0], opponent: TRUE_OGRE }, 'the second round, the first won kept');
  assert.equal(state.scene, Scene.MOVIE, 'the ending');
  assert.equal(state.run.ending.code, PAUL * 4);
  assert.equal(state.world.match.ogreChanged, 1);
});

test('start cuts Ogre\'s change short; Heihachi is dressed as Jin for it', { skip }, async () => {
  let changing = 0;
  const pads = (field, game) => (game.state.step === FightStep.OGRE_CHANGING && ++changing === 30 ? START : 0);
  const { state, seen } = await lastStage(HEIHACHI, pads);
  assert.equal(seen.dressedAs, JIN);
  assert.equal(seen.changeFields, 31, 'its set-up\'s field, then thirty, the last with start');
  assert.ok(seen.trueOgre !== null, 'True Ogre fought');
  assert.equal(state.run.ending.code, HEIHACHI * 4);
  assert.notEqual(state.world.fighters[1].roster, OGRE);
});
