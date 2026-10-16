/**
 * The game's state saved and restored whole for an online match's rollback, on the imported data: a
 * Versus fight saved, played on, restored, is the state it was, by its fingerprint and field by
 * field; played on again from the same pads it ends where the first run ended; and a slot is filled
 * again without being made again.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { StateSnapshotter } from '../src/net/snapshot.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

/** A Versus match, both pads in, played to its fight; its snapshotter told each match's data. */
async function versusFight() {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  let snapshotter = null;
  const made = new Map();
  const fightData = (setup) => {
    const [a, b] = matchMovesets(tables, setup);
    const key = `${a} ${b}`;
    if (!made.has(key)) made.set(key, fightDataFor(tables, setup, (id) => movesets.get(id), common));
    snapshotter?.share(made.get(key));
    return made.get(key);
  };
  const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
  snapshotter = new StateSnapshotter(game.state);
  snapshotter.share(tables);
  snapshotter.share(scenes);
  startMode(game.state, MenuMode.VERSUS, 1);
  for (let field = 0; field < 3000 && !(game.state.scene === Scene.FIGHT && game.state.world.round.flow >= 2); field += 1) game.field(field % 20 === 0 ? [0x40, 0x40] : [0, 0]);
  assert.equal(game.state.scene, Scene.FIGHT, 'the fight began');
  for (let field = 0; field < 400; field += 1) game.field([field % 7 === 0 ? 0x40 : 0, field % 5 === 0 ? 0x20 : 0]);
  return { game, snapshotter };
}

/** Each field's pads, varied: steps, punches and kicks on both sides. */
const pads = Array.from({ length: 300 }, (_, i) => [[0x40, 0x2000, 0x80, 0][i % 4] * (i % 3 === 0 ? 1 : 0), [0x20, 0x8000, 0x10, 0][(i >> 1) % 4] * (i % 2)]);

test('a fight saved, played on and restored is the state it was, and plays on as it did', { skip }, async () => {
  const { game, snapshotter } = await versusFight();
  const slot = snapshotter.create();
  snapshotter.save(slot);
  const saved = JSON.stringify(game.state);
  const fingerprint = snapshotter.digest(slot);
  assert.equal(snapshotter.digestNow(), fingerprint, 'the slot holds the state');
  for (const p of pads) game.field(p);
  const played = JSON.stringify(game.state);
  const after = snapshotter.digestNow();
  assert.notEqual(after, fingerprint, 'the fight moved on');
  snapshotter.restore(slot);
  assert.equal(snapshotter.digestNow(), fingerprint, 'restored, by its fingerprint');
  assert.equal(JSON.stringify(game.state), saved, 'restored, field by field');
  for (const p of pads) game.field(p);
  assert.equal(snapshotter.digestNow(), after, 'played on again, it ends where it ended');
  assert.equal(JSON.stringify(game.state), played);
});

test('a slot is filled again in place, and a save and a restore take a fraction of a field', { skip }, async () => {
  const { game, snapshotter } = await versusFight();
  const slot = snapshotter.create();
  snapshotter.save(slot);
  const fighters = slot.world.fighters;
  for (let field = 0; field < 60; field += 1) game.field([0, 0]);
  snapshotter.save(slot);
  assert.equal(slot.world.fighters, fighters, 'the same slot');
  const start = performance.now();
  for (let i = 0; i < 50; i += 1) {
    snapshotter.save(slot);
    snapshotter.restore(slot);
  }
  const each = (performance.now() - start) / 50;
  assert.ok(each < 8, `a save and a restore took ${each.toFixed(2)} ms`);
});
