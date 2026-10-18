/**
 * A double knockout, on a fight from the imported data: a round to each; where it brings both to the
 * rounds that win the match, the game's tie-break gives it to one side (by its streak, online always
 * the host's), while the draw rule an online match's two games agree on (`Start`'s `draws`) makes it
 * a draw.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';

/** A two-player fight, its first round under way; both knocked out together with `wins` rounds each, under `rule`: the match's winner (3 a draw) and the rounds each has. */
async function doubleKnockout(rule, wins) {
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
  const state = fight.state;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  state.match.drawRule = rule;
  for (const f of state.fighters.slice(0, 2)) {
    f.wins = wins;
    f.health = 0;
  }
  const rounds = state.round.number;
  for (let field = 0; field < 60 && state.match.winner === 0 && state.round.number === rounds; field += 1) fight.field([0, 0]);
  return { winner: state.match.winner, wins: state.fighters.slice(0, 2).map((f) => f.wins), needed: state.match.roundsToWin };
}

test('a double knockout gives a round to each; at match point for both, the tie-break gives the match to one side, the draw rule makes it a draw', { skip }, async () => {
  const ordinary = await doubleKnockout(0, 0);
  assert.deepEqual([ordinary.winner, ordinary.wins], [0, [1, 1]], 'a round to each, the match goes on');
  const tieBreak = await doubleKnockout(0, ordinary.needed - 1);
  assert.equal(tieBreak.winner, 1, 'the old rule: the first side wins it');
  const draw = await doubleKnockout(1, ordinary.needed - 1);
  assert.deepEqual([draw.winner, draw.wins], [3, [draw.needed, draw.needed]], 'the agreed rule: a draw');
});
