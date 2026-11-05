/**
 * An online match's start, on the imported data: played as a version whose start carries the host's
 * power-on values, two games whose discs power on with other records and options make the same
 * state; played as an older version, each makes it from its own disc's, as that version does.
 * Skipped without the imported data.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PLAYS_AS } from '../src/net/online.ts';
import { StateSnapshotter } from '../src/net/snapshot.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const skip = !existsSync(path.join(assets, 'tables/scenes.json')) && 'no imported data; run npm run extract and npm run import';

/** The game's data as imported here. */
async function imported() {
  const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { loadFightTables } = await import('../src/assets/load.ts');
  const { tables, scenes } = await loadFightTables(json);
  return { tables, scenes, fightData: () => null, introData: () => null };
}

/** The same data as a disc whose executable powers on otherwise: another time record, more plays, the screen elsewhere. */
function otherDisc(data) {
  const on = structuredClone(data.scenes.powerOn);
  on.times[0] = { frames: on.times[0].frames + 600, initials: 'ZZZ' };
  on.plays[3][1] += 7;
  on.options.display = { x: on.options.display.x + 3, y: on.options.display.y + 1 };
  return { ...data, scenes: { ...data.scenes, powerOn: on } };
}

/** A start as a host gives it, with `carried` (its power-on values, where the version played carries them) among its options. */
const startWith = (carried) => ({
  k: 'start',
  options: { difficulty: 1, rounds: 1, roundTime: 2, alwaysChip: 0, continueChooses: 0, modeSetting: 0, keepChoices: 0, musicSet: 0, stereo: 1, earnedRoster: 4095, extraCostumes: 2, stage: 40, walls: 1, ...carried },
  delay: 2,
  keys: [
    [12, 12, 12, 12, 1, 3, 2, 0],
    [6, 5, 8, 4, 1, 3, 2, 0],
  ],
  fighters: [
    { roster: 4, costume: 0 },
    { roster: 20, costume: 0 },
  ],
  match: 1,
  draws: 1,
});

/** A game on `data` as it begins a match from `start` played as `as`: its state and that state's fingerprint. */
async function begun(data, start, as) {
  const { Game } = await import('../src/sim/game/game.ts');
  const { matchStart } = await import('../src/app/match-start.ts');
  const game = new Game(data);
  /* Restored as the page restores it: by a snapshotter that knows the data's objects. */
  const snapshotter = new StateSnapshotter(game.state);
  snapshotter.share(data.tables);
  snapshotter.share(data.scenes);
  matchStart(game.state, data, start, as, snapshotter);
  return { state: game.state, digest: new StateSnapshotter(game.state, ['remake', 'online']).digestNow() };
}

test("played as this version, two games whose discs power on otherwise begin a match alike, from the host's power-on values", { skip }, async () => {
  const { carriedPowerOn } = await import('../src/app/match-start.ts');
  const host = await imported();
  const guest = otherDisc(host);
  const start = startWith(carriedPowerOn(PLAYS_AS, host));
  const [a, b] = [await begun(host, start, PLAYS_AS), await begun(guest, start, PLAYS_AS)];
  assert.equal(b.state.records.times[0].initials, a.state.records.times[0].initials, "the host's records");
  assert.deepEqual(b.state.options.display, a.state.options.display, "the host's screen");
  assert.equal(b.digest, a.digest, 'the same state as the match begins');
});

test('played as 0.7.15, each game begins a match from its own disc\'s power-on values, as 0.7.15 does: none carried, and any carried left', { skip }, async () => {
  const { carriedPowerOn } = await import('../src/app/match-start.ts');
  const host = await imported();
  const guest = otherDisc(host);
  assert.deepEqual(carriedPowerOn('0.7.15', host), {}, 'a host playing as 0.7.15 carries none');
  for (const start of [startWith({}), startWith({ powerOn: host.scenes.powerOn })]) {
    const [a, b] = [await begun(host, start, '0.7.15'), await begun(guest, start, '0.7.15')];
    assert.equal(b.state.records.times[0].initials, 'ZZZ', "the guest's own records");
    assert.notEqual(b.digest, a.digest, 'so the two differ as they begin');
  }
});

test("a start's power-on values that are not whole are not taken: the game begins from its own", { skip }, async () => {
  const host = await imported();
  const guest = otherDisc(host);
  for (const broken of [{ times: 'none' }, { ...host.scenes.powerOn, plays: [] }, 7]) {
    const { state } = await begun(guest, startWith({ powerOn: broken }), PLAYS_AS);
    assert.equal(state.records.times[0].initials, 'ZZZ', "the guest's own records");
  }
});

test("the disc's word: the same with or without Kazuya on the select, another for a disc that powers on otherwise", { skip }, async () => {
  const { discWord } = await import('../src/app/match-start.ts');
  const data = await imported();
  const word = discWord(data.scenes);
  assert.match(word, /^[0-9a-f]{16}$/);
  assert.equal(discWord({ ...data.scenes, select: { ...data.scenes.select, added: [] } }), word, 'Kazuya left out');
  assert.notEqual(discWord(otherDisc(data).scenes), word, 'another executable');
});
