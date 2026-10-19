/**
 * Two sides of an online match over a link made bad on purpose (the engine's loopback network: its
 * delays, drops and reorderings decided by a seed): a small made-up game, and two Versus games on the
 * imported data. Each side steps from its own pad at once and the other's as it arrives; both end
 * with the same game, field by field, whatever the link did, rolling back where a word came late;
 * a game made to differ on one side is caught, naming the field; a side that hears nothing waits,
 * and gives up after five seconds of it.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LoopbackNetwork } from '@driftengine/network';

import { MatchSession, ROLLBACK_DEPTH, STALL_DISCONNECT } from '../src/net/session.ts';
import { StateSnapshotter } from '../src/net/snapshot.ts';
import { releaseCode } from './lib/release.mjs';

const FIELD_MS = 1000 / 60;

/** A made-up game: two points moved by their pads' words, and a counter mixing both in every field. */
function toyGame() {
  const state = { at: [0, 0], mix: 1, fields: 0, trail: new Int32Array(4) };
  return {
    state,
    field([a, b]) {
      state.at[0] += (a & 1) - ((a >> 1) & 1);
      state.at[1] += (b & 1) - ((b >> 1) & 1);
      state.mix = (Math.imul(state.mix ^ (a * 31 + b), 0x01000193) + state.fields) >>> 0;
      state.trail[state.fields & 3] = state.mix;
      state.fields += 1;
    },
  };
}

/** Each seat's word at a field: a run of presses that changes every few fields, different on each side. */
const script = (seat, field) => {
  const phase = Math.floor(field / (seat === 0 ? 7 : 11));
  return [1, 2, 0, 3, 1, 0][(phase + seat * 3) % 6];
};

/** Both sides of a match over one loopback network, each stepping its own game. */
function pair(games, impairment, { delay = [2, 2], seed = 7 } = {}) {
  const network = new LoopbackNetwork();
  const sides = games.map((game, seat) => {
    const snapshotter = game.snapshotter ?? new StateSnapshotter(game.state);
    const transport = network.open({ self: seat, impairment, seed: seed + seat });
    const fingerprints = new Map();
    const session = new MatchSession({
      step: (words, field) => {
        game.field(words);
        if ((field & 31) === 0) fingerprints.set(field, snapshotter.digestNow());
      },
      snapshotter,
      transport,
      self: seat,
      inputDelay: delay,
    });
    return { game, snapshotter, session, fingerprints };
  });
  return { network, sides };
}

/** Runs both sides `fields` frames, each pressing its script, the link's clock moved a field a frame. */
function run({ network, sides }, fields, word = script) {
  for (let frame = 0; frame < fields; frame += 1) {
    for (const [seat, side] of sides.entries()) side.session.advance(word(seat, side.session.tick));
    network.advance(FIELD_MS);
  }
}

/** The fields both sides have fingerprinted, with neither guessing any word for it, and whether they agree. */
function agreed(sides, below) {
  const [a, b] = sides.map((side) => side.fingerprints);
  const ticks = [...a.keys()].filter((tick) => tick < below && b.has(tick));
  return { ticks, differ: ticks.filter((tick) => a.get(tick) !== b.get(tick)) };
}

test('a made-up game played over a bad link ends the same on both sides, rolled back where words came late', () => {
  const match = pair([toyGame(), toyGame()], { latencyMs: 60, jitterMs: 25, loss: 0.1, reorder: 0.1, reorderMs: 30, duplicate: 0.05 });
  run(match, 1200);
  const [a, b] = match.sides;
  assert.equal(a.session.desync, null, a.session.reason);
  assert.equal(b.session.desync, null, b.session.reason);
  assert.ok(a.session.quality.rollbacks > 0 && b.session.quality.rollbacks > 0, 'late words were rolled back');
  assert.ok(a.session.quality.deepest <= ROLLBACK_DEPTH + 1, `at most the window (${a.session.quality.deepest})`);
  const safe = Math.min(a.session.tick, b.session.tick) - 2 * ROLLBACK_DEPTH;
  const { ticks, differ } = agreed(match.sides, safe);
  assert.ok(ticks.length > 20, `fields compared: ${ticks.length}`);
  assert.deepEqual(differ, [], 'the same game, field by field');
});

test("on a good link inside the input delay nothing is guessed, and the sides' input delay is the larger asked for", () => {
  const match = pair([toyGame(), toyGame()], { latencyMs: 15 }, { delay: [1, 3] });
  run(match, 600);
  for (const side of match.sides) {
    assert.equal(side.session.inputDelay, 3);
    assert.equal(side.session.quality.stalls, 0);
    assert.equal(side.session.state, 'running');
  }
  assert.deepEqual(agreed(match.sides, 560).differ, []);
});

test('a game made to differ on one side is caught at a field both have every word for, and named', () => {
  const games = [toyGame(), toyGame()];
  const match = pair(games, { latencyMs: 30, jitterMs: 5 });
  run(match, 300);
  games[1].state.at[0] += 5;
  run(match, 120);
  const caught = match.sides.find((side) => side.session.desync !== null);
  assert.ok(caught !== undefined, 'a side caught it');
  assert.equal(caught.session.state, 'desynced');
  const { tick } = caught.session.desync;
  assert.ok(290 <= tick && tick <= 300 + 60, `named the field (${tick})`);
});

test('a side that waits while its pad changes sends each field one word, and the games stay the same', () => {
  const match = pair([toyGame(), toyGame()], { latencyMs: 70, jitterMs: 40, loss: 0.2, reorder: 0.1, reorderMs: 40 }, { delay: [1, 1] });
  const [a, b] = match.sides;
  for (let frame = 0; frame < 1500; frame += 1) {
    /* The first side runs unevenly: two frames some steps, none in others; both pads change every frame, waiting or not. */
    const runs = frame % 5 === 0 ? 0 : frame % 7 === 0 ? 2 : 1;
    for (let i = 0; i < runs; i += 1) a.session.advance((frame * 3 + i) & 3);
    b.session.advance((frame * 5) & 3);
    match.network.advance(FIELD_MS);
  }
  assert.equal(a.session.desync, null, a.session.reason);
  assert.equal(b.session.desync, null, b.session.reason);
  assert.ok(a.session.quality.stalls + b.session.quality.stalls > 0, 'a side waited');
  const safe = Math.min(a.session.tick, b.session.tick) - 2 * ROLLBACK_DEPTH;
  const { ticks, differ } = agreed(match.sides, safe);
  assert.ok(ticks.length > 20, `fields compared: ${ticks.length}`);
  assert.deepEqual(differ, []);
});

test('a tap made while a side waits for the other is played with the next field, on both sides', () => {
  const games = [toyGame(), toyGame()];
  const match = pair(games, { latencyMs: 20 });
  run(match, 60, () => 0);
  const [a, b] = match.sides;
  for (let frame = 0; frame < 40; frame += 1) {
    /* The other side gone a while: this one waits, its pad tapped once in the wait. */
    a.session.advance(frame === 20 ? 1 : 0);
    match.network.advance(FIELD_MS);
  }
  assert.equal(a.session.state, 'stalled');
  run(match, 120, () => 0);
  assert.equal(games[0].state.at[0], 1, 'the tap was played here');
  assert.equal(games[1].state.at[0], 1, 'and there');
  assert.equal(b.session.desync, null);
});

test('two presses made one after the other while a side waits are played one after the other, never together', () => {
  /* A game that keeps the first pad's word of each field it plays (put right where a rollback plays it again). */
  const played = [new Map(), new Map()];
  const games = played.map((words) => {
    const state = { fields: 0 };
    return { state, field: ([a]) => (words.set(state.fields, a), (state.fields += 1)) };
  });
  const match = pair(games, { latencyMs: 20 });
  run(match, 60, () => 0);
  const [a] = match.sides;
  for (let frame = 0; frame < 40; frame += 1) {
    /* The other side gone a while: this one waits, its pad pressing 1, letting go, then pressing 2. */
    a.session.advance(18 <= frame && frame < 22 ? 1 : 25 <= frame && frame < 28 ? 2 : 0);
    match.network.advance(FIELD_MS);
  }
  assert.equal(a.session.state, 'stalled');
  run(match, 120, () => 0);
  for (const [side, words] of played.entries()) {
    const seen = [...words.entries()].sort(([x], [y]) => x - y).map(([, word]) => word).filter((word) => word !== 0);
    assert.ok(!seen.includes(3), `side ${side}: never both at once (${seen.join(' ')})`);
    assert.deepEqual([...new Set(seen)], [1, 2], `side ${side}: 1, then 2`);
  }
});

test('a side that leaves fields out while its pad keeps changing plays each press a steady few fields after it is made, never later and later', () => {
  /* The first pad's word of each field played on the first side, and the frame it was first played on. */
  const firstAt = new Map();
  let frame = 0;
  const games = [0, 1].map((seat) => {
    const state = { fields: 0 };
    return { state, field: ([a]) => { if (seat === 0 && !firstAt.has(state.fields)) firstAt.set(state.fields, { frame, word: a }); state.fields += 1; } };
  });
  const match = pair(games, { latencyMs: 30, jitterMs: 10 });
  const [a, b] = match.sides;
  /* Buttons 1 to 4 tapped in turn, five frames down and four up, the stick moving under them. */
  const BUTTONS = [0x80, 0x10, 0x40, 0x20];
  const pad = (f) => (f % 9 < 5 ? BUTTONS[Math.floor(f / 9) % 4] : 0) | ((f >> 2) & 1 ? 0x2000 : 0);
  const made = [];
  for (; frame < 1800; frame += 1) {
    const word = pad(frame);
    if ((word & 0xf0) !== 0 && (pad(frame - 1) & 0xf0) !== (word & 0xf0)) made.push(frame);
    a.session.advance(word);
    /* The second side's page runs a little slow: this one, ahead, waits and leaves fields out. */
    if (frame % 7 !== 0) b.session.advance(0);
    match.network.advance(FIELD_MS);
  }
  assert.ok(a.session.quality.stalls + a.session.quality.skipped > 50, 'the first side waited and left fields out');
  const fields = [...firstAt.entries()].sort(([x], [y]) => x - y).map(([, v]) => v);
  const playedAt = fields.filter((v, i) => i > 0 && (v.word & 0xf0) !== 0 && (fields[i - 1].word & 0xf0) !== (v.word & 0xf0)).map((v) => v.frame);
  const lags = playedAt.map((at, i) => at - made[i]);
  assert.ok(lags.length > 150, `presses played: ${lags.length}`);
  assert.ok(Math.max(...lags.slice(-40)) <= 12, `still played within a few fields at the end: ${lags.slice(-12).join(' ')}`);
});

test("a mirrored player's stick: its left and right swapped, its up and down and its buttons as they are", async () => {
  const { mirroredStick } = await import('../src/net/wire.ts');
  const [UP, RIGHT, DOWN, LEFT, SQUARE, TRIANGLE, CROSS, CIRCLE] = [0x1000, 0x2000, 0x4000, 0x8000, 0x80, 0x10, 0x40, 0x20];
  assert.equal(mirroredStick(DOWN | RIGHT | TRIANGLE), DOWN | LEFT | TRIANGLE, "down and forward on the screen with a button: down and the game's left, the same button");
  assert.equal(mirroredStick(LEFT), RIGHT);
  assert.equal(mirroredStick(UP | LEFT | RIGHT), UP | LEFT | RIGHT, 'both held: both');
  assert.equal(mirroredStick(SQUARE | TRIANGLE | CROSS | CIRCLE), SQUARE | TRIANGLE | CROSS | CIRCLE, 'the buttons never swapped: a move is its button');
  assert.equal(mirroredStick(mirroredStick(DOWN | LEFT | CROSS)), DOWN | LEFT | CROSS);
});

test("a match's words reach only it: the last match's, sent again as it ended, are passed over by the next on the same link", () => {
  const network = new LoopbackNetwork();
  const transports = [0, 1].map((seat) => network.open({ self: seat, seed: 3 + seat }));
  const sessions = (match) =>
    [toyGame(), toyGame()].map((game, seat) => {
      const fingerprints = new Map();
      const snapshotter = new StateSnapshotter(game.state);
      const session = new MatchSession({ step: (words, field) => (game.field(words), (field & 7) === 0 && fingerprints.set(field, snapshotter.digestNow())), snapshotter, transport: transports[seat], self: seat, inputDelay: [2, 2], match });
      return { game, session, fingerprints };
    });
  const first = sessions(1);
  for (let frame = 0; frame < 60; frame += 1) {
    first.forEach((side, seat) => side.session.advance(script(seat, side.session.tick)));
    network.advance(FIELD_MS);
  }
  const next = sessions(2);
  for (let frame = 0; frame < 120; frame += 1) {
    /* The first match's side keeps sending its last words again, as it does while the other may be behind. */
    if (frame % 3 === 0) first[0].session.sendAgain();
    next.forEach((side, seat) => side.session.advance(script(seat + 1, side.session.tick)));
    network.advance(FIELD_MS);
  }
  assert.deepEqual(next.map((side) => side.session.state), ['running', 'running'], `no difference found (${next[0].session.reason || next[1].session.reason})`);
  const { ticks, differ } = agreed(next, Math.min(...next.map((side) => side.session.tick)) - 2 * ROLLBACK_DEPTH);
  assert.ok(ticks.length > 8);
  assert.deepEqual(differ, [], 'the same game, field by field');
});

test('a side that hears nothing waits past the rollback window, and calls it a disconnection after five seconds', () => {
  const match = pair([toyGame(), toyGame()], { latencyMs: 20 });
  run(match, 120);
  const [a] = match.sides;
  const before = a.session.tick;
  for (let frame = 0; frame < STALL_DISCONNECT + 30; frame += 1) {
    a.session.advance(1);
    match.network.advance(FIELD_MS);
  }
  assert.ok(a.session.tick - before <= ROLLBACK_DEPTH + 4, `stopped within the window (${a.session.tick - before})`);
  assert.equal(a.session.state, 'disconnected');
  assert.equal(a.session.quality.stalls, 1);
});

/* ---- Versus on the imported data ---- */

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';

/** Two Versus games at their select, both pads in, on the same loaded data; each one's snapshotter told each match's data. */
async function versusGames() {
  const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { loadFightTables, loadMoveset } = await import('../src/assets/load.ts');
  const { fightDataFor, matchMovesets } = await import('../src/sim/fight/match.ts');
  const { Game } = await import('../src/sim/game/game.ts');
  const { MenuMode, startMode } = await import('../src/sim/game/menu.ts');
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, String(id).padStart(2, '0')));
  const common = await loadMoveset(json, 'common');
  const made = new Map();
  return [0, 1].map(() => {
    const snapshotters = [];
    const fightData = (setup) => {
      const [a, b] = matchMovesets(tables, setup);
      const key = `${a} ${b}`;
      if (!made.has(key)) made.set(key, fightDataFor(tables, setup, (id) => movesets.get(id), common));
      for (const s of snapshotters) s.share(made.get(key));
      return made.get(key);
    };
    const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
    const snapshotter = new StateSnapshotter(game.state, ['remake']);
    snapshotter.share(tables);
    snapshotter.share(scenes);
    snapshotters.push(snapshotter);
    startMode(game.state, MenuMode.VERSUS, 1);
    return { state: game.state, game, snapshotter, field: (words) => game.field(words), scene: () => game.state.scene };
  });
}

/** Each seat's pad: choosing at the select every so often, then steps, punches and kicks. */
const versusScript = (seat, field) => {
  if (field < 900) return field % 23 === seat * 5 ? 0x40 : 0;
  const pick = Math.floor(field / (seat === 0 ? 5 : 9)) % 8;
  return [0x2000, 0x40, 0, 0x8000, 0x80, 0x10, 0, 0x20][(pick + seat * 3) % 8];
};

test('two Versus games over a bad link pick their characters, fight, and stay the same game', { skip, timeout: 240_000 }, async () => {
  const games = await versusGames();
  const match = pair(games, { latencyMs: 45, jitterMs: 20, loss: 0.05, reorder: 0.05, reorderMs: 20 });
  run(match, 1800, versusScript);
  const [a, b] = match.sides;
  assert.equal(a.session.desync, null, a.session.reason);
  assert.equal(b.session.desync, null, b.session.reason);
  const { Scene } = await import('../src/sim/game/state.ts');
  assert.equal(games[0].scene(), Scene.FIGHT, 'they reached the fight');
  assert.ok(a.session.quality.rollbacks > 0, 'late words were rolled back');
  const safe = Math.min(a.session.tick, b.session.tick) - 2 * ROLLBACK_DEPTH;
  const { ticks, differ } = agreed(match.sides, safe);
  assert.ok(ticks.length > 30, `fields compared: ${ticks.length}`);
  assert.deepEqual(differ, [], 'the same game, field by field');
});

test('two Versus games with the walls over a bad link reach the wall and stay the same game', { skip, timeout: 300_000 }, async () => {
  const games = await versusGames();
  const { MenuMode, startMode } = await import('../src/sim/game/menu.ts');
  const { WALL_REACH, BODY } = await import('../src/sim/fight/walls.ts');
  for (const g of games) {
    g.state.remake.settings.walls = 1;
    startMode(g.state, MenuMode.VERSUS, 1);
  }
  assert.ok(games.every((g) => g.state.world.options.walls === 1), 'the walls on both');
  const match = pair(games, { latencyMs: 45, jitterMs: 20, loss: 0.05, reorder: 0.05, reorderMs: 20 });
  /* Past the select, both walk the same way, the second backing off, a punch now and then. */
  const toTheWall = (seat, field) => (field < 900 ? (field % 23 === seat * 5 ? 0x40 : 0) : field % 40 < 34 ? 0x2000 : [0x80, 0x10][seat]);
  let most = 0;
  for (let k = 0; k < 3000; k += 100) {
    run(match, 100, toTheWall);
    for (const f of games[0].state.world.fighters.slice(0, 2)) most = Math.max(most, Math.abs(f.skeleton.base.translation[0]), Math.abs(f.skeleton.base.translation[2]));
  }
  const [a, b] = match.sides;
  assert.equal(a.session.desync, null, a.session.reason);
  assert.equal(b.session.desync, null, b.session.reason);
  assert.ok(most >= WALL_REACH - BODY - 100, `a fighter reached the wall (${most})`);
  assert.ok(most <= WALL_REACH - BODY, 'and no further');
  const safe = Math.min(a.session.tick, b.session.tick) - 2 * ROLLBACK_DEPTH;
  const { differ } = agreed(match.sides, safe);
  assert.deepEqual(differ, [], 'the same game, field by field');
});

/**
 * A Versus game at its select, both pads in, from a release's code (`load`, its modules by their
 * paths) on the imported data, its snapshotter leaving out each machine's own parts and `left`.
 */
async function versusGameOf(load, left = []) {
  /* An older release's code reads the assets this one imported, which hold all its own, as the format it wrote. */
  const { ASSET_FORMAT } = await load('src/assets/manifest.ts');
  const json = async (name) => {
    const read = JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
    return name === 'manifest.json' ? { ...read, format: ASSET_FORMAT } : read;
  };
  const { loadFightTables, loadMoveset } = await load('src/assets/load.ts');
  const { fightDataFor, matchMovesets } = await load('src/sim/fight/match.ts');
  const { Game } = await load('src/sim/game/game.ts');
  const { MenuMode, startMode } = await load('src/sim/game/menu.ts');
  const { StateSnapshotter: Snapshotter } = await load('src/net/snapshot.ts');
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, String(id).padStart(2, '0')));
  const common = await loadMoveset(json, 'common');
  const made = new Map();
  let snapshotter = null;
  const fightData = (setup) => {
    const [a, b] = matchMovesets(tables, setup);
    const key = `${a} ${b}`;
    if (!made.has(key)) made.set(key, fightDataFor(tables, setup, (id) => movesets.get(id), common));
    snapshotter?.share(made.get(key));
    return made.get(key);
  };
  const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
  snapshotter = new Snapshotter(game.state, ['remake', 'online'], left);
  snapshotter.share(tables);
  snapshotter.share(scenes);
  startMode(game.state, MenuMode.VERSUS, 1);
  return { state: game.state, game, snapshotter, field: (words) => game.field(words), scene: () => game.state.scene, Snapshotter };
}

/**
 * This release's Versus game beside one of `version`'s own code, as two players' games: they pick
 * their characters, fight and stay the same game over a bad link, the fields of the state that
 * version lacks left out of this one's fingerprint; `check` sees both games as they start.
 */
async function besideRelease(t, version, check = () => {}) {
  const older = releaseCode(version);
  if (older === null) return t.skip(`no git, or no tag v${version}, to play beside`);
  try {
    const { ALSO_PLAYS } = await import('../src/net/online.ts');
    const left = ALSO_PLAYS[version];
    assert.ok(left !== undefined, `${version} is played`);
    const games = [await versusGameOf(older.load), await versusGameOf((file) => import(`../${file}`), left)];
    check(games);
    /* As they start: the same fingerprint with those fields left out, another with them in. */
    assert.equal(games[1].snapshotter.digestNow(), games[0].snapshotter.digestNow(), 'the same game as they start');
    if (left.length > 0) assert.notEqual(new StateSnapshotter(games[1].state, ['remake', 'online']).digestNow(), games[0].snapshotter.digestNow(), "the fields it lacks in, they differ");
    const match = pair(games, { latencyMs: 45, jitterMs: 20, loss: 0.05, reorder: 0.05, reorderMs: 20 });
    run(match, 2400, versusScript);
    const [a, b] = match.sides;
    assert.equal(a.session.desync, null, a.session.reason);
    assert.equal(b.session.desync, null, b.session.reason);
    const { Scene } = await import('../src/sim/game/state.ts');
    assert.equal(games[1].scene(), Scene.FIGHT, 'they reached the fight');
    assert.ok(a.session.quality.rollbacks > 0, 'late words were rolled back');
    const safe = Math.min(a.session.tick, b.session.tick) - 2 * ROLLBACK_DEPTH;
    const { ticks, differ } = agreed(match.sides, safe);
    assert.ok(ticks.length > 30, `fields compared: ${ticks.length}`);
    assert.deepEqual(differ, [], 'the same game, field by field');
  } finally {
    older.remove();
  }
}

test("a Versus game of this release with the walls off and one of 0.6.5 pick their characters, fight and stay the same game over a bad link, the fields the walls added left out of this one's fingerprint", { skip, timeout: 300_000 }, (t) =>
  besideRelease(t, '0.6.5', (games) => assert.equal(games[1].state.world.options.walls, 0, "no walls on this release's side")));

test("a Versus game of this release and one of 0.7.0 pick their characters, fight and stay the same game over a bad link, the field of the players who see the fight from the other side left out of this one's fingerprint", { skip, timeout: 300_000 }, (t) => besideRelease(t, '0.7.0'));

test('a Versus game of this release and one of 0.7.6 pick their characters, fight and stay the same game over a bad link, nothing left out of either fingerprint', { skip, timeout: 300_000 }, (t) => besideRelease(t, '0.7.6'));
