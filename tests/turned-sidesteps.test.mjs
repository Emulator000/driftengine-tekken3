/**
 * The moves into and out of the screen for a player who sees the fight from the other side (an
 * online match where both asked for the same side, `depthTurned`): a tap up, or the L2 shortcut,
 * goes into their screen, which is out of the game's, and a tap down out of it; up held still
 * jumps and down held still crouches, field for field as ever; the other player's as ever.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';

const [UP, DOWN, L2] = [0x1000, 0x4000, 0x01];

/** A two-player fight under way, the pads in `turned` (a bit a pad) seeing it from the other side. */
async function fightOf(turned) {
  const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { loadFightTables, loadMoveset } = await import('../src/assets/load.ts');
  const { fightDataFor, matchMovesets } = await import('../src/sim/fight/match.ts');
  const { Fight } = await import('../src/sim/fight/fight.ts');
  const { tables } = await loadFightTables(json);
  const setup = { stage: 2, entrants: [{ roster: 6, costume: 0, computer: false }, { roster: 9, costume: 0, computer: false }] };
  const [first, second] = matchMovesets(tables, setup);
  const two = (n) => String(n).padStart(2, '0');
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const fight = Fight.quick(fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common')), setup);
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  fight.state.match.depthTurned = turned;
  return fight;
}

/** Pad `pad` pressing `buttons` for `held` fields, then nothing, 30 fields in all: its fighter's move and place (across the fight's line, and up) each field. */
async function played(turned, pad, buttons, held) {
  const fight = await fightOf(turned);
  const f = fight.state.fighters[pad];
  const from = [...f.skeleton.base.translation];
  const trace = [];
  for (let field = 0; field < 30; field += 1) {
    const words = [0, 0];
    if (field < held) words[pad] = buttons;
    fight.field(words);
    const at = f.skeleton.base.translation;
    trace.push([f.moveId, at[2] - from[2], at[1] - from[1]]);
  }
  return trace;
}

const across = (trace) => trace.at(-1)[1];

test('seen from the other side, a tap up and the L2 shortcut go into that screen, a tap down out of it', { skip }, async () => {
  for (const pad of [0, 1]) {
    const up = across(await played(0, pad, UP, 2));
    const down = across(await played(0, pad, DOWN, 2));
    assert.ok(up > 500 && down < -500, `as the game sees it, up goes one way and down the other (pad ${pad}: ${up}, ${down})`);
    assert.ok(across(await played(1 << pad, pad, UP, 2)) < -500, `turned, a tap up goes the other way (pad ${pad})`);
    assert.ok(across(await played(1 << pad, pad, DOWN, 2)) > 500, `turned, a tap down too (pad ${pad})`);
    assert.ok(across(await played(1 << pad, pad, L2, 2)) < -500, `turned, the L2 shortcut too (pad ${pad})`);
  }
});

test('seen from the other side, up held still jumps and down held still crouches, field for field; the other pad plays as ever', { skip }, async () => {
  for (const buttons of [UP, DOWN]) {
    assert.deepEqual(await played(1, 0, buttons, 30), await played(0, 0, buttons, 30), `${buttons === UP ? 'a jump' : 'a crouch'} as ever`);
    assert.deepEqual(await played(1, 1, buttons, 2), await played(0, 1, buttons, 2), "the other pad's tap as ever");
  }
});
