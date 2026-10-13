/**
 * Tekken Force out of the fight, on the imported data: the records it keeps (the best score, the
 * keys, Dr. B earned), the versus screen's layout (the human alone, the stage and its name), and
 * the results: the score, the best and the run's keys come in turn, start on the human's pad alone
 * ends them and they fade out to the records; with Dr. B earned before the run the bosses show and
 * the soldiers beaten count up to the run's.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode } from '../src/sim/game/menu.ts';
import { addForceKey, drBEarned, earnDrB, setForceBest } from '../src/sim/game/records.ts';
import { ForceStep, forceBossesShown } from '../src/sim/game/results.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const START = 0x800;
const PAUL = 0;

async function game() {
  const { tables, scenes } = await loadFightTables(json);
  const g = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  return { game: g, state: g.state, tables, scenes };
}

/** A game at Tekken Force's results, the human on the second pad, the run's block as given. */
async function results(run) {
  const t = await game();
  const { state } = t;
  state.world.mode = MenuMode.TEKKEN_FORCE;
  Object.assign(state.entrants, { roster: [0x15, PAUL], costume: [0, 1], chosen: [0, 1], computer: [1, 0] });
  Object.assign(state.world.match.force, { score: 123450, kills: 3, side: 1, newRecord: 1, flags: 0, ...run });
  state.records.forceBest = 123450;
  Object.assign(state, { scene: Scene.FORCE_RESULTS, step: ForceStep.SET_UP });
  return t;
}

const printed = (state, text) => state.printed.some((run) => run.text.includes(text));
/** Fields until the results have shown `shown` fields. */
function until(t, shown, pads = [0, 0]) {
  for (let field = 0; field < 2000 && t.state.results.force.shown < shown; field += 1) t.game.field(pads);
  assert.equal(t.state.results.force.shown, shown);
}

test("the records keep Tekken Force's best and its keys (at most 255), and Dr. B is earned once", { skip }, async () => {
  const { state, scenes } = await game();
  state.records.changed = 0;
  setForceBest(state, scenes, 1000);
  assert.equal(state.records.forceBest, 1000);
  assert.equal(state.records.changed, 1, 'to be saved');
  state.records.forceKeys = 0xfe;
  addForceKey(state, scenes);
  addForceKey(state, scenes);
  assert.equal(state.records.forceKeys, 0xff);
  state.records.earnedRoster &= ~(1 << 0x13);
  assert.equal(drBEarned(state), 0);
  earnDrB(state);
  assert.equal(drBEarned(state), 1);
  assert.equal(state.records.newest, 0x13, 'the newest earned');
  state.records.newest = 3;
  earnDrB(state);
  assert.equal(state.records.newest, 3, 'earned only once');
});

test("the versus screen shows the human alone, the mode's and the stage's lines and the stage's name", { skip }, async () => {
  const { game: g, state } = await game();
  state.world.mode = MenuMode.TEKKEN_FORCE;
  Object.assign(state.entrants, { roster: [PAUL, 0x15], costume: [2, 0] });
  state.world.match.force.side = 0;
  state.world.match.stage = 3;
  state.versusPortraits[1] = 7;
  Object.assign(state, { scene: Scene.VERSUS, step: 0 });
  Object.assign(state.run.after, { scene: Scene.FIGHT, step: 3 });
  g.field([0, 0]);
  g.field([0, 0]);
  const records = state.versus.records;
  const portraits = records.filter((r) => r.kind === 'portrait');
  assert.equal(portraits.length, 1, 'one portrait');
  assert.deepEqual([portraits[0].side, portraits[0].x, portraits[0].y], [0, 12, 212]);
  assert.equal(state.versusPortraits[1], 7, "the other side's portrait left as it was");
  const texts = records.filter((r) => r.kind === 'text').map((r) => r.text);
  assert.deepEqual(texts, ['TEKKEN FORCE', 'STAGE 4']);
  const names = records.filter((r) => r.kind === 'name');
  assert.equal(names[0].text, 'PAUL');
  assert.equal(names[0].y, 390);
  assert.deepEqual(
    names.slice(1).map((r) => [r.text.trim(), r.x + r.text.length * 21, r.y, r.slideX]),
    [
      ['MISHIMA', 356, 120, 368],
      ['FORTRESS', 356, 166, 368],
    ],
    "the stage's name right-aligned in two lines, sliding in from the right",
  );
  const band = records.find((r) => r.kind === 'band');
  assert.deepEqual([band.colour, band.width], [0xf87090, 0xe8]);
  assert.deepEqual(records.find((r) => r.kind === 'background'), { kind: 'background', picture: 0 });
  state.world.match.stage = 4;
  Object.assign(state, { scene: Scene.VERSUS, step: 0 });
  g.field([0, 0]);
  g.field([0, 0]);
  assert.ok(state.versus.records.some((r) => r.kind === 'text' && r.text === 'FINAL STAGE'));
  assert.ok(state.versus.records.some((r) => r.kind === 'name' && r.text === 'UNDERGROUND'));
});

test('the results show the score, the best and the keys in turn; start on the human\'s pad alone ends them, then the records', { skip }, async () => {
  const t = await results({ flags: 3 });
  const { state } = t;
  until(t, 0x1d);
  assert.ok(!printed(state, 'YOUR SCORE:'));
  until(t, 0x1e);
  assert.ok(printed(state, 'YOUR SCORE:'));
  assert.ok(state.printed.some((run) => run.text === '123450' && run.x === 0xf9 + 2 * 13), 'the score right-aligned in eight places');
  assert.ok(!printed(state, 'HIGH SCORE:'));
  until(t, 0x3c);
  assert.ok(printed(state, 'HIGH SCORE:') && printed(state, 'NEW RECORD!!'));
  until(t, 0x5a);
  assert.ok(printed(state, 'KEYS:') && printed(state, 'COPPER'));
  assert.ok(!printed(state, 'SILVER'));
  until(t, 0x78);
  assert.ok(printed(state, 'SILVER'));
  until(t, 0xb4);
  assert.ok(!printed(state, 'GOLD'), 'no gold key held');
  until(t, 0xd0);
  assert.ok(printed(state, 'TO BE CONTINUED...'));
  t.game.field([START, 0]);
  assert.equal(state.step, ForceStep.SHOWN, "the other pad's start does nothing");
  t.game.field([0, 0]);
  t.game.field([0, START]);
  assert.equal(state.step, ForceStep.FADE_OUT);
  let fields = 0;
  for (; fields < 200 && state.scene === Scene.FORCE_RESULTS; fields += 1) t.game.field([0, 0]);
  assert.equal(state.scene, Scene.RECORDS_LOADER, 'on to the records');
  assert.ok(60 < fields && fields < 70, `a fade out of 64 fields (${fields})`);
});

test('the results say Dr. B is saved when the final stage was cleared', { skip }, async () => {
  const t = await results({ flags: 7 | 8 });
  until(t, 0x5a);
  assert.ok(printed(t.state, 'YOU SAVED') && printed(t.state, 'DR.BOSKONOVITCH!'));
  assert.ok(!printed(t.state, 'KEYS:'));
});

test('with Dr. B earned before the run, the bosses show one by one and the soldiers beaten count up to the run\'s', { skip }, async () => {
  const t = await results({ flags: 0x10, kills: 5, bosses: [0x04, 0x2c, 0x24, 0x34] });
  const { state } = t;
  until(t, 0x59);
  assert.equal(forceBossesShown(state), 0);
  until(t, 0x5a);
  assert.ok(printed(state, 'BOSS:'));
  assert.equal(forceBossesShown(state), 1);
  until(t, 0x6d);
  assert.equal(forceBossesShown(state), 2);
  until(t, 0x95);
  assert.equal(forceBossesShown(state), 4);
  const counts = [];
  for (let field = 0; field < 200; field += 1) {
    t.game.field([0, 0]);
    const run = state.printed.find((r) => r.y === 0x17c && r.font === 1);
    if (run !== undefined) counts.push(Number(run.text));
  }
  assert.equal(counts[0], 0, 'counted from nothing');
  assert.equal(counts.at(-1), 5, "to the run's");
  assert.ok(counts.every((n, k) => k === 0 || counts[k - 1] <= n), 'counting up');
  assert.equal(state.results.force.countState, 2);
});
