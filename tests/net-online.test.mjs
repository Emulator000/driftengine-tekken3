/**
 * Online play end to end on this machine: the server (`server/relay.mjs`) on a free port, and two
 * players' sides over real WebSockets, each playing a small made-up game: a quick match pairs them
 * and they play the same game; a room hosted is joined by its code, and listed in the room list
 * while it waits; players are paired whatever fighters each has, unless one chose a fighter the
 * other lacks, and another version is refused; a player leaving ends the other's
 * match; a match over asks both for a rematch; the server's counts are told, and a way to it that fails gives way to the next; its page for a browser says how busy it is and how to play on it; the server's settings come from a file, the environment and the command line in turn.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

import { Relay, readConfig } from '../server/relay.mjs';
import { ALSO_PLAYS, Online, PLAYS_AS } from '../src/net/online.ts';
import { StateSnapshotter } from '../src/net/snapshot.ts';
import { releaseCode } from './lib/release.mjs';

const quiet = { log: () => {} };

async function server(settings = [], now = undefined) {
  const relay = new Relay(readConfig(['--host', '127.0.0.1', '--port', '0', ...settings], {}), { ...quiet, ...(now === undefined ? {} : { now }) });
  const port = await relay.listen();
  return { relay, url: `ws://127.0.0.1:${port}/` };
}

/** Every roster id, Kazuya's (22) among them. */
const EVERY = Array.from({ length: 23 }, (_, i) => i);

/** A side: its made-up game (its version, the fighters whose data it has), the fighter it chose (`pick` changes it), and what began and ended. */
/** The game's own button setup as it powers on (each of the pad's eight buttons an entry of its table of thirteen; 12 none), and one of a player's own. */
const DEFAULT_KEYS = [12, 12, 12, 12, 1, 3, 2, 0];
const OWN_KEYS = [12, 12, 12, 12, 0, 1, 2, 3];

function side(url, { version = '0.6.1', plays, roster = EVERY, fighter = 0, name = 'A', delay = 2, now, keys = DEFAULT_KEYS, id, seen } = {}) {
  const chosen = { fighter };
  const log = { began: null, ended: null, begun: 0, waited: 0, optionsAs: null, steps: [] };
  const state = { at: [0, 0], mix: 1, fields: 0 };
  const game = {
    version,
    ...(plays === undefined ? {} : { plays }),
    roster,
    keyChoices: 13,
    defaultKeys: DEFAULT_KEYS,
    options: (as) => {
      log.optionsAs = as;
      return { rounds: 3 };
    },
    begin(start, seat, as) {
      log.began = { start, seat, as };
      log.begun += 1;
      /* Every match from the same start, as the game's own begins from the state it powers on with. */
      Object.assign(state, { at: [0, 0], mix: 1, fields: 0 });
      log.steps = [];
      return {
        step: ([a, b], field) => {
          log.steps[field] = [a, b];
          state.at[0] += a & 1;
          state.at[1] += b & 1;
          state.mix = (Math.imul(state.mix ^ (a * 7 + b), 0x01000193) + state.fields) >>> 0;
          state.fields += 1;
        },
        snapshotter: new StateSnapshotter(state),
      };
    },
    end(why) {
      log.ended = why;
    },
    waiting() {
      log.waited += 1;
    },
  };
  const online = new Online({ url: () => url, game, player: () => ({ name, delay, keys, fighter: { roster: chosen.fighter, costume: 0 }, ...(id === undefined ? {} : { id }), ...(seen === undefined ? {} : { side: seen }) }), open: (at) => new WebSocket(at), peerConnection: null, now });
  return { online, state, log, pick: (to) => (chosen.fighter = to) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Frames of both sides every 16 ms until `done`, at most `most`. */
async function frames(sides, done, most = 600, word = (seat, frame) => (frame >> 3) & 1) {
  for (let frame = 0; frame < most; frame += 1) {
    if (done()) return frame;
    sides.forEach((one) => one.online.frame(word(one.online.seat, frame)));
    await sleep(4);
  }
  return most;
}

test('a quick match pairs two players, the host starts it and both play the same game', async () => {
  const { relay, url } = await server();
  const a = side(url, { name: 'Host', delay: 1 });
  const b = side(url, { name: 'Guest', delay: 3, keys: OWN_KEYS });
  try {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
    assert.equal(a.online.opponent, 'GUEST', 'offered each other first');
    assert.ok(8 < a.online.offerLeft && a.online.offerLeft <= 10);
    a.online.answer(true);
    await frames([a, b], () => false, 20);
    assert.equal(a.online.state, 'offered', 'one yes is not enough');
    b.online.answer(true);
    await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
    assert.equal(a.online.state, 'playing');
    assert.equal(b.online.state, 'playing');
    assert.equal(a.online.opponent, 'GUEST');
    assert.equal(b.online.opponent, 'HOST');
    assert.deepEqual([a.log.began.seat, b.log.began.seat], [0, 1]);
    assert.equal(b.log.began.start.delay, 3, "the larger delay asked for");
    assert.deepEqual(b.log.began.start.keys, [DEFAULT_KEYS, OWN_KEYS], "each player's own buttons, the game's setup as it powers on among them");
    assert.deepEqual(b.log.began.start.options, { rounds: 3 }, "the host's options");
    await frames([a, b], () => a.online.session === null || b.online.session === null || (a.online.session.tick > 300 && b.online.session.tick > 300), 2000);
    assert.ok(a.online.session !== null && b.online.session !== null, `the match went on (${a.log.ended} ${a.online.ended}, ${b.log.ended} ${b.online.ended})`);
    assert.equal(a.online.session.desync, null);
    assert.equal(b.online.session.desync, null);
    assert.ok(a.online.roundTripMs > 0, 'the round trip was measured');
    /* Both went on from the same words: the fields both have played agree. */
    await frames([a, b], () => false, 30, () => 0);
    assert.ok(Math.abs(a.state.fields - b.state.fields) <= 12);
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

/** Two sides paired by a quick match and playing, through `relay`'s `url`, the host's and the guest's options `host` and `guest`. */
async function playing(url, host = {}, guest = {}) {
  const a = side(url, { name: 'Host', ...host });
  const b = side(url, { name: 'Guest', ...guest });
  a.online.quickMatch();
  await frames([a, b], () => a.online.state === 'queued');
  b.online.quickMatch();
  await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
  a.online.answer(true);
  b.online.answer(true);
  await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
  return [a, b];
}

/**
 * Both sides' frames until `done`, each told whether it is ready and whether it stands on the
 * fight's last loading field: field `line` of the match, the guest still loading there until
 * `loaded()` says otherwise.
 */
async function toTheFight(a, b, line, loaded, done, most = 1500) {
  for (let frame = 0; frame < most; frame += 1) {
    if (done()) return frame;
    for (const one of [a, b]) {
      const at = one.online.session?.tick === line;
      const ready = one === a || !at || loaded(frame);
      one.online.frame((frame >> 3) & 1, ready, at);
    }
    await sleep(4);
  }
  return most;
}

test("a side ready for the fight holds on its last loading field, saying no wait itself, until the other is ready too: both then start it", async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  try {
    const line = a.online.session.tick + 40;
    let loadedAt = 600;
    await toTheFight(a, b, line, (frame) => frame >= loadedAt, () => false, 400);
    assert.equal(a.online.session.tick, line, 'the host holds on the line, not past it');
    assert.equal(b.online.session.tick, line, 'the guest loading on it');
    assert.equal(a.online.theyWait, true, 'the host told the guest is loading');
    assert.equal(b.online.theyWait, false, 'the guest told nothing of a wait by the host');
    loadedAt = 0;
    await toTheFight(a, b, line, () => true, () => a.online.session.tick > line + 60 && b.online.session.tick > line + 60);
    assert.ok(a.online.session.tick > line + 60 && b.online.session.tick > line + 60, 'both went on into the fight');
    assert.equal(a.online.session.desync, null);
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("a page that has played a match carries no word of being ready into its next pairing: a fresh player paired with it next goes into the fight with it", async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  const c = side(url, { name: 'Fresh' });
  try {
    /* A first match, through the hold into the fight, over with no rematch. */
    const first = a.online.session.tick + 40;
    await toTheFight(a, b, first, () => true, () => a.online.session.tick > first + 60 && b.online.session.tick > first + 60);
    a.online.matchOver();
    b.online.matchOver();
    b.online.rematch(false);
    await frames([a, b], () => a.online.state === 'lobby' && b.online.state === 'lobby');
    b.online.disconnect();
    /* The same page paired with a fresh one: its match numbered 1 again. */
    a.online.quickMatch();
    await frames([a, c], () => a.online.state === 'queued');
    c.online.quickMatch();
    await frames([a, c], () => a.online.state === 'offered' && c.online.state === 'offered');
    a.online.answer(true);
    c.online.answer(true);
    await frames([a, c], () => a.online.state === 'playing' && c.online.state === 'playing');
    assert.equal(c.log.began.start.match, a.log.began.start.match, "the same match number as the page's last");
    const line = a.online.session.tick + 40;
    await toTheFight(a, c, line, () => true, () => a.online.session === null || c.online.session === null || (a.online.session.tick > line + 60 && c.online.session.tick > line + 60), 900);
    assert.ok(a.online.session !== null && c.online.session !== null, `the match went on (${a.online.ended} ${c.online.ended})`);
    assert.ok(c.online.session.tick > line + 60, `the fresh player went into the fight, not held on its last loading field (${c.online.session.tick}, the line ${line})`);
    assert.ok(a.online.session.tick > line + 60, `and the page with it (${a.online.session.tick})`);
  } finally {
    a.online.disconnect();
    c.online.disconnect();
    await relay.close();
  }
});

test("a side holding for the other goes into the fight once the other has been neither loading nor ready a few seconds: one that went in without saying so (a 0.7.0 page that thought it had)", async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  try {
    /* The guest's hello as one before 0.7.6's, which may go in without a word; it never says it is ready, and goes in as one told the host already is. */
    a.online.theirs = { ...a.online.theirs, saysReady: undefined };
    const send = b.online.relay.toPeer.bind(b.online.relay);
    b.online.relay.toPeer = (message) => (message.k === 'ready' ? undefined : send(message));
    const line = a.online.session.tick + 40;
    await toTheFight(a, b, line, () => true, () => false, 120);
    assert.equal(a.online.session.tick, line, 'the host holds a while for a word');
    await toTheFight(a, b, line, () => true, () => a.online.session === null || b.online.session === null || (a.online.session.tick > line + 60 && b.online.session.tick > line + 60), 900);
    assert.ok(a.online.session !== null && b.online.session !== null, `the match went on (${a.online.ended} ${b.online.ended})`);
    assert.ok(a.online.session.tick > line + 60 && b.online.session.tick > line + 60, `both went into the fight (${a.online.session.tick} ${b.online.session.tick}, the line ${line})`);
    assert.equal(a.online.session.desync, null);
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("a side ready for the fight holds on its last loading field for as long as the other is heard loading, however slowly the other's frames come, where the other always says when it is ready: neither shows the fight before both can", async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  try {
    assert.equal(a.online.theirs.saysReady, true, 'the guest says in its hello that it always says so');
    const line = a.online.session.tick + 40;
    /* Up to the line together; there the guest loads, its frames coming a sixtieth as often as the host's (a slow phone's), for well over the three seconds an older one is waited. */
    await toTheFight(a, b, line, () => true, () => a.online.session.tick === line && b.online.session.tick === line, 600);
    let frame = 0;
    for (; frame < 1200; frame += 1) {
      a.online.frame(0, true, a.online.session.tick === line);
      if (frame % 60 === 0) b.online.frame(0, false, true);
      await sleep(4);
    }
    assert.equal(a.online.state, 'playing', `the host still waits for the guest (${a.online.ended})`);
    assert.equal(a.online.session.tick, line, 'on its last loading field, not in the fight without the other');
    const done = await toTheFight(a, b, line, () => true, () => a.online.session.tick > line + 60 && b.online.session.tick > line + 60, 900);
    assert.ok(done < 900, `both went on into the fight once the guest was ready (${a.online.session.tick} ${b.online.session.tick})`);
    assert.equal(a.online.session.desync, null);
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("where both players ask to be seen on the same side, the start says which of them sees the fight from the other side; both seen as they asked, neither; with a game that says nothing of its side (one before 0.7.6), no word of it", async () => {
  const { relay, url } = await server();
  const sides = [];
  try {
    for (const [host, guest, turned] of [[0, 0, 2], [1, 1, 1], [0, 1, undefined], [1, 0, 3]]) {
      const pair = await playing(url, { seen: host }, { seen: guest });
      sides.push(...pair);
      assert.equal(pair[0].log.began.start.turned, turned, `the host asking for side ${host}, the guest for ${guest}`);
      assert.equal(pair[1].log.began.start.turned, turned, 'the guest begun by the same start');
      for (const one of pair) one.online.disconnect();
    }
    const older = await playing(url, { seen: 0 }, {});
    sides.push(...older);
    assert.equal(older[0].log.began.start.turned, undefined, 'the guest said nothing of its side: no word of it');
  } finally {
    for (const one of sides) one.online.disconnect();
    await relay.close();
  }
});

test("a match whose other side stops playing ends as a disconnection after five seconds, though its page still answers the pings", async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  try {
    const line = a.online.session.tick + 40;
    await toTheFight(a, b, line, () => true, () => a.online.session.tick > line + 60 && b.online.session.tick > line + 60);
    /* The guest's game stops (its frames no longer run); its socket still answers. */
    let frame = 0;
    for (; frame < 600 && a.online.state === 'playing'; frame += 1) {
      a.online.frame((frame >> 3) & 1);
      await sleep(4);
    }
    assert.notEqual(a.online.state, 'playing', `the host's match ended (${frame} frames, ${a.online.session?.state})`);
    assert.ok(frame >= 300, `not before five seconds of it (${frame})`);
    assert.equal(a.online.ended, 'THE CONNECTION WAS LOST');
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("two games that play a level match point as a draw agree on it in the match's start; with an older one, which says nothing of it, the match is played by the old rule", async () => {
  const { relay, url } = await server();
  const sides = [];
  try {
    const [a, b] = await playing(url);
    sides.push(a, b);
    assert.equal(a.log.began.start.draws, 1, "the host's start says it");
    assert.equal(b.log.began.start.draws, 1, 'the guest begun by it');
    a.online.disconnect();
    b.online.disconnect();
    /* A guest whose hello says nothing of it, as 0.7.3's. */
    const c = side(url, { name: 'Host' });
    const d = side(url, { name: 'Older' });
    sides.push(c, d);
    c.online.connect();
    d.online.connect();
    await frames([c, d], () => c.online.state === 'lobby' && d.online.state === 'lobby');
    const send = d.online.relay.toPeer.bind(d.online.relay);
    d.online.relay.toPeer = (message) => send(message.k === 'hello' ? { ...message, draws: undefined } : message);
    /* The newer one queued first, so it hosts. */
    c.online.quickMatch();
    await frames([c, d], () => false, 30);
    d.online.quickMatch();
    await frames([c, d], () => c.online.state === 'offered' && d.online.state === 'offered');
    c.online.answer(true);
    d.online.answer(true);
    await frames([c, d], () => c.online.state === 'playing' && d.online.state === 'playing');
    assert.equal(c.log.began.start.draws, undefined, `no word of it in the start (the host's seat ${c.log.began.seat}, the older's ${d.log.began.seat})`);
  } finally {
    for (const one of sides) one.online.disconnect();
    await relay.close();
  }
});

test("a fight between two games that tape it can be watched: listed with both players' names and streaks, its start and every press so far given to the one watching, the presses after as they come, each the press its player's game played; the watcher told as it ends", async () => {
  const { relay, url } = await server();
  const sides = [];
  try {
    const [a, b] = await playing(url);
    const c = side(url, { name: 'Watcher' });
    sides.push(a, b, c);
    c.online.connect();
    await frames([a, b, c], () => c.online.state === 'lobby' && a.online.session?.tick > 90 && b.online.session?.tick > 90, 800);
    c.online.listFights();
    await frames([a, b, c], () => c.online.fights.length === 1, 200);
    const [fight] = c.online.fights;
    assert.ok(fight !== undefined, 'the fight listed');
    assert.deepEqual([fight.names, fight.watchable], [['HOST', 'GUEST'], true], 'by its players, which this game can watch');
    c.online.watch(fight.code);
    await frames([a, b, c], () => c.online.state === 'watching' && Math.min(...(c.online.tape?.words.map((w) => w.length) ?? [0])) > 240, 900);
    const tape = c.online.tape;
    assert.ok(tape !== null, 'the fight given');
    assert.equal(tape.start.match, a.log.began.start.match, 'its start');
    const final = Math.min(a.online.session.final, b.online.session.final, tape.words[0].length, tape.words[1].length);
    assert.ok(final > 200, `presses to compare (${final})`);
    for (let field = 0; field < final; field += 1) {
      assert.deepEqual([tape.words[0][field], tape.words[1][field]], a.log.steps[field], `field ${field} as the host played it`);
    }
    a.online.disconnect();
    await frames([b, c], () => c.online.state !== 'watching', 300);
    assert.equal(c.online.state, 'lobby', 'back once the fight is over');
    assert.equal(c.online.tape, null);
  } finally {
    for (const one of sides) one.online.disconnect();
    await relay.close();
  }
});

test("a fight where one game does not tape (one before 0.7.5) is not listed", async () => {
  const { relay, url } = await server();
  const sides = [];
  try {
    const [a, b] = await playing(url);
    /* The guest's game sends none of its presses, as an older one. */
    const say = b.online.relay.say.bind(b.online.relay);
    b.online.relay.say = (command) => (command.do === 'words' ? undefined : say(command));
    const c = side(url, { name: 'Watcher' });
    sides.push(a, b, c);
    c.online.connect();
    await frames([a, b, c], () => c.online.state === 'lobby' && a.online.session?.tick > 90, 800);
    c.online.listFights();
    await frames([a, b, c], () => false, 60);
    assert.equal(c.online.fights.length, 0);
  } finally {
    for (const one of sides) one.online.disconnect();
    await relay.close();
  }
});

test('a side does not hold for an older one, which says nothing of being ready', async () => {
  const { relay, url } = await server();
  const [a, b] = await playing(url);
  try {
    /* The guest's hello as an older version's: no word that it starts each fight with the other. */
    a.online.theirs = { ...a.online.theirs, together: undefined };
    const line = a.online.session.tick + 40;
    await toTheFight(a, b, line, () => false, () => false, 300);
    assert.ok(a.online.session.tick > line, 'the host went on past the line, as before');
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("a game that also plays as an older version is paired with that version's players, both told to play it and the match set up and begun as it; two of the newer play the newer; a version neither plays is not paired", async () => {
  const { relay, url } = await server();
  const NEWER = { version: '0.7.0', plays: ['0.7.0', '0.6.5'] };
  const sides = [];
  const make = (options) => {
    const one = side(url, options);
    sides.push(one);
    return one;
  };
  const meet = async (a, b) => {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered', 120);
    if (a.online.state !== 'offered') return false;
    a.online.answer(true);
    b.online.answer(true);
    await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
    await frames([a, b], () => a.online.session?.tick > 60 && b.online.session?.tick > 60, 800);
    return true;
  };
  try {
    const newer = make({ name: 'New', ...NEWER });
    const older = make({ name: 'Old', version: '0.6.5' });
    assert.ok(await meet(newer, older), 'the newer and the older paired');
    assert.deepEqual([newer.log.optionsAs, newer.log.began.as, newer.log.began.seat], ['0.6.5', '0.6.5', 0], "the newer, hosting, sets the match up and plays it as the older");
    assert.equal(older.log.began.as, '0.6.5', 'the older plays its own');
    assert.equal(newer.online.session.desync, null);
    assert.equal(older.online.session.desync, null);
    for (const one of [newer, older]) one.online.disconnect();
    const first = make({ name: 'First', ...NEWER });
    const second = make({ name: 'Second', ...NEWER });
    assert.ok(await meet(first, second), 'two of the newer paired');
    assert.deepEqual([first.log.began.as, second.log.began.as], ['0.7.0', '0.7.0'], 'they play the newer');
    for (const one of [first, second]) one.online.disconnect();
    const third = make({ name: 'Third', ...NEWER });
    const oldest = make({ name: 'Oldest', version: '0.6.0' });
    assert.equal(await meet(third, oldest), false, 'a version neither plays is not paired');
  } finally {
    for (const one of sides) one.online.disconnect();
    await relay.close();
  }
});

test('a room is joined by its code, listed while it waits if asked; a player leaving ends the match for the other', async () => {
  const { relay, url } = await server();
  const a = side(url);
  const b = side(url);
  try {
    a.online.host(true);
    await frames([a, b], () => a.online.state === 'hosting' && a.online.code !== '');
    assert.match(a.online.code, /^[A-Z2-9]{4}$/);
    b.online.connect();
    await frames([a, b], () => b.online.state === 'lobby');
    b.online.listRooms(true);
    await frames([a, b], () => b.online.rooms.length > 0);
    assert.deepEqual(b.online.rooms.map((room) => [room.code, room.same, room.locked]), [[a.online.code, true, false]]);
    b.online.join(b.online.rooms[0].code);
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
    assert.equal(a.online.opponent, 'A', 'the host is asked too');
    a.online.answer(true);
    b.online.answer(true);
    await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
    await frames([a, b], () => a.online.session.tick > 60);
    b.online.cancel();
    await frames([a, b], () => a.online.state === 'lobby');
    assert.equal(a.online.state, 'lobby');
    assert.equal(a.log.ended, 'left');
    assert.equal(a.online.ended, 'THE OTHER PLAYER LEFT');
    assert.equal(b.log.ended, 'quit');
    assert.equal(b.online.ended, 'MATCH OVER');
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test('players are paired whatever fighters each has, unless one chose a fighter the other lacks; a wrong code and another version are refused with a reason', async () => {
  const { relay, url } = await server();
  const withoutKazuya = EVERY.filter((fighter) => fighter !== 22);
  const a = side(url, { fighter: 22 });
  const b = side(url, { roster: withoutKazuya, fighter: 3 });
  const old = side(url, { version: '0.6.0' });
  try {
    b.online.join('ZZZZ');
    await frames([a, b, old], () => b.online.ended !== '');
    assert.equal(b.online.ended, 'NO ROOM WITH THAT CODE');
    a.online.host(true);
    await frames([a, b, old], () => a.online.state === 'hosting' && a.online.code !== '');
    b.online.listRooms(true);
    await frames([a, b, old], () => b.online.rooms.length > 0);
    assert.equal(b.online.rooms[0].same, false, "a room whose host plays a fighter this side lacks, greyed");
    b.online.join(a.online.code);
    await frames([a, b, old], () => b.online.ended !== '' && b.online.ended !== 'NO ROOM WITH THAT CODE');
    assert.equal(b.online.ended, 'YOU LACK FIGHTER 22', "the host's Kazuya, whom this side lacks");
    a.online.cancel();
    b.online.listRooms(false);
    a.online.quickMatch();
    b.online.quickMatch();
    await frames([a, b, old], () => false, 40);
    assert.deepEqual([a.online.state, b.online.state], ['queued', 'queued'], 'not paired while one plays a fighter the other lacks');
    a.pick(5);
    a.online.quickMatch();
    await frames([a, b, old], () => a.online.state === 'offered' && b.online.state === 'offered');
    assert.equal(a.online.state, 'offered', 'paired once both fighters are ones both have, their rosters differing still');
    a.online.cancel();
    b.online.cancel();
    old.online.host(false);
    await frames([a, b, old], () => old.online.state === 'hosting' && old.online.code !== '');
    a.online.join(old.online.code);
    await frames([a, b, old], () => a.online.ended !== '');
    assert.equal(a.online.ended, 'THE OTHER PLAYER HAS VERSION 0.6.0');
  } finally {
    for (const one of [a, b, old]) one.online.disconnect();
    await relay.close();
  }
});

test("a no puts both back in the queue, kept apart; an offer not answered in time puts them back to look again", async () => {
  const { relay, url } = await server(['--offer', '1']);
  const [a, b, c] = [side(url, { name: 'A' }), side(url, { name: 'B' }), side(url, { name: 'C' })];
  try {
    a.online.quickMatch();
    await frames([a, b, c], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b, c], () => a.online.state === 'offered' && b.online.state === 'offered');
    b.online.answer(false);
    await frames([a, b, c], () => a.online.state === 'queued' && b.online.state === 'queued');
    assert.equal(a.online.state, 'queued', 'back in the queue');
    await frames([a, b, c], () => false, 30);
    assert.equal(a.online.state, 'queued', 'and not offered each other again');
    c.online.quickMatch();
    await frames([a, b, c], () => c.online.state === 'offered');
    const [offered] = [a, b].filter((one) => one.online.state === 'offered');
    assert.ok(offered !== undefined, 'a newcomer is offered one of them');
    offered.online.answer(true);
    await frames([a, b, c], () => c.online.state !== 'offered', 400);
    await frames([a, b, c], () => c.online.state === 'offered', 60);
    assert.ok(c.online.state === 'queued' || c.online.state === 'offered', `the newcomer looks again (${c.online.state})`);
    assert.ok(offered.online.state === 'queued' || offered.online.state === 'offered', 'and so does the one who said yes');
  } finally {
    for (const one of [a, b, c]) one.online.disconnect();
    await relay.close();
  }
});

test("a no keeps the two apart thirty seconds, then offers them each other again where neither has found another", async () => {
  const clock = { ms: 0 };
  const { relay, url } = await server([], () => Date.now() + clock.ms);
  const [a, b] = [side(url, { name: 'A' }), side(url, { name: 'B' })];
  try {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
    b.online.answer(false);
    await frames([a, b], () => a.online.state === 'queued' && b.online.state === 'queued');
    clock.ms = 29_000;
    await sleep(400);
    await frames([a, b], () => false, 30);
    assert.deepEqual([a.online.state, b.online.state], ['queued', 'queued'], 'kept apart a while');
    clock.ms = 31_000;
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered', 200);
    assert.deepEqual([a.online.state, b.online.state], ['offered', 'offered'], 'then offered each other again');
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test("a player is offered only while their game says it is available (in the waiting room's fight, playing, in sight): one that is not waits in the queue unoffered until it is; a game that says nothing of it is taken as available", async () => {
  const { relay, url } = await server();
  const [a, b] = [side(url, { name: 'A' }), side(url, { name: 'B' })];
  try {
    a.online.setAvailable(false);
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => false, 40);
    assert.deepEqual([a.online.state, b.online.state], ['queued', 'queued'], 'not offered while one is not available');
    a.online.setAvailable(true);
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered', 120);
    assert.deepEqual([a.online.state, b.online.state], ['offered', 'offered'], 'offered once it is');
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test("a yes that reaches the server a moment after the offer's time is up still counts", async () => {
  const clock = { ms: 0 };
  const { relay, url } = await server([], () => Date.now() + clock.ms);
  const [a, b] = [side(url, { name: 'A' }), side(url, { name: 'B' })];
  try {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
    a.online.answer(true);
    await frames([a, b], () => false, 10);
    clock.ms = 10_500;
    await sleep(400);
    b.online.answer(true);
    const paired = (one) => one.online.state === 'greeting' || one.online.state === 'playing';
    await frames([a, b], () => paired(a) && paired(b), 200);
    assert.ok(paired(a) && paired(b), `both yeses taken, the two paired (${a.online.state} ${b.online.state})`);
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test("a room's host is offered the player joining only while both are available, the one joining waiting until then", async () => {
  const { relay, url } = await server();
  const [a, b] = [side(url, { name: 'Host' }), side(url, { name: 'Guest' })];
  try {
    a.online.setAvailable(false);
    a.online.host(false);
    await frames([a, b], () => a.online.state === 'hosting' && a.online.code !== '');
    b.online.join(a.online.code);
    await frames([a, b], () => false, 40);
    assert.deepEqual([a.online.state, b.online.state], ['hosting', 'joining'], 'the guest waits while the host is not available');
    a.online.setAvailable(true);
    await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered', 120);
    assert.deepEqual([a.online.state, b.online.state], ['offered', 'offered'], 'offered once it is');
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test("a match over asks both for a rematch: two yeses play again, a no or no answer sends both back to waiting, a quick match's two kept apart", async () => {
  const { relay, url } = await server();
  const shift = { ms: 0 };
  const now = () => Date.now() + shift.ms;
  const a = side(url, { name: 'A', now });
  const b = side(url, { name: 'B', now });
  const both = (state) => () => a.online.state === state && b.online.state === state;
  const play = async () => {
    await frames([a, b], () => a.online.session !== null && b.online.session !== null && a.online.session.tick > 60 && b.online.session.tick > 60, 800);
    assert.ok(a.online.session !== null && b.online.session !== null, `the match played (${a.online.ended} ${b.online.ended})`);
    assert.equal(a.online.session.desync, null);
    a.online.matchOver();
    b.online.matchOver();
  };
  try {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], both('offered'));
    a.online.answer(true);
    b.online.answer(true);
    await frames([a, b], both('playing'));
    await play();
    assert.deepEqual([a.online.state, b.online.state, a.log.ended, b.log.ended], ['result', 'result', 'over', 'over']);
    assert.ok(29 < a.online.resultLeft && a.online.resultLeft <= 30);
    a.online.rematch(true);
    await frames([a, b], () => false, 20);
    assert.equal(a.online.state, 'result', 'one yes is not enough');
    b.online.rematch(true);
    await frames([a, b], both('playing'));
    assert.deepEqual([a.log.begun, b.log.begun, b.log.began.seat], [2, 2, 1], 'the same two again, in their seats');
    await play();
    b.online.rematch(false);
    await frames([a, b], both('lobby'));
    assert.deepEqual([a.online.ended, b.online.ended, a.log.waited, b.log.waited], ['NO REMATCH', 'NO REMATCH', 1, 1]);
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued');
    b.online.quickMatch();
    await frames([a, b], () => false, 30);
    assert.deepEqual([a.online.state, b.online.state], ['queued', 'queued'], 'not offered each other again a while');
    a.online.host(false);
    await frames([a, b], () => a.online.state === 'hosting' && a.online.code !== '');
    b.online.join(a.online.code);
    await frames([a, b], both('offered'));
    a.online.answer(true);
    b.online.answer(true);
    await frames([a, b], both('playing'));
    await play();
    shift.ms = 31_000;
    await frames([a, b], both('lobby'));
    assert.deepEqual([a.online.ended, b.online.ended, a.log.waited, b.log.waited], ['NO REMATCH', 'NO REMATCH', 2, 2], 'no answer in time, no rematch');
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("the server's players and its queue told with each pong; a way to it that fails tried no more, what was asked of it asked of the next", async () => {
  const { relay, url } = await server();
  /* The first way to the server one no server answers on: the next one, the real one, reached. */
  const dead = 'ws://127.0.0.1:9/';
  const a = side([dead, url], { name: 'A' });
  const b = side(url, { name: 'B' });
  try {
    a.online.quickMatch();
    await frames([a, b], () => a.online.state === 'queued', 300);
    assert.equal(a.online.state, 'queued', 'the quick match asked before the way failed, carried to the next');
    b.online.connect();
    await frames([a, b], () => b.online.state === 'lobby' && b.online.players === 2 && b.online.queued === 1, 300);
    assert.deepEqual([b.online.players, b.online.queued], [2, 1], 'two on the server, one of them in the quick match');
  } finally {
    a.online.disconnect();
    b.online.disconnect();
    await relay.close();
  }
});

test("the server's page, for a browser: how busy it is, its versions, and the address to play on it, no player's address in it", async () => {
  const { relay, url } = await server(['--name', 'HOME SERVER']);
  const port = new URL(url).port;
  const a = side(url, { name: 'Host' });
  const b = side(url, { name: 'Guest' });
  const c = side(url, { name: 'Waiter', version: '0.6.4' });
  try {
    a.online.host(true);
    await frames([a, b, c], () => a.online.state === 'hosting' && a.online.code !== '');
    c.online.quickMatch();
    b.online.connect();
    await frames([a, b, c], () => b.online.state === 'lobby' && c.online.queued === 1);
    let status = await fetch(`http://127.0.0.1:${port}/status.json`).then((r) => r.json());
    const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));
    assert.deepEqual({ name: status.name, version: status.version, oldest: status.oldest }, { name: 'HOME SERVER', version: pkg.version, oldest: '0.6.0' }, "the server's own version the game's");
    assert.deepEqual([status.players, status.queued, status.fights, status.rooms], [3, 1, 0, 1]);
    assert.deepEqual(status.listed, [{ title: "HOST'S ROOM", host: 'HOST', version: '0.6.1' }]);
    assert.deepEqual(status.versions, { '0.6.1': 2, '0.6.4': 1 }, 'the versions being played');
    assert.ok(!JSON.stringify(status).includes('127.0.0.1'), 'no player addressed');
    b.online.join(a.online.code);
    await frames([a, b, c], () => a.online.state === 'offered' && b.online.state === 'offered');
    a.online.answer(true);
    b.online.answer(true);
    await frames([a, b, c], () => a.online.state === 'playing' && b.online.state === 'playing');
    status = await fetch(`http://127.0.0.1:${port}/status.json`).then((r) => r.json());
    assert.deepEqual([status.fights, status.rooms, status.listed.length], [1, 0, 0], 'a fight on, its room no longer waiting');
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await page.text();
    assert.ok(html.includes(`"ws://127.0.0.1:${port}"`), 'the address to type in SERVER');
    assert.ok(html.includes('"/status.json"'));
    assert.ok(html.includes('id="lamp"'), 'the lamp lit while the server answers');
    assert.ok(html.includes('An unofficial server') && html.includes('Bandai Namco Entertainment or Sony Interactive Entertainment'), 'says it is unofficial and whose it is not');
    assert.equal((await fetch(`http://127.0.0.1:${port}/nothing`)).status, 404);
  } finally {
    for (const one of [a, b, c]) one.online.disconnect();
    await relay.close();
  }
});

const order = (v) => v.split('.').map(Number).reduce((sum, part) => sum * 1000 + part, 0);

test("a release is paired as the oldest one it plays exactly as, its simulation and its match's words those of that release", (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8')).version;
  assert.match(PLAYS_AS, /^\d+\.\d+\.\d+$/);
  assert.ok(order('0.6.0') <= order(PLAYS_AS) && order(PLAYS_AS) <= order(game), `${PLAYS_AS} lies between the oldest version the server serves and the game's own, ${game}`);
  /* The older ones it also plays are played beside their own code (net-session.test.mjs). */
  for (const older of Object.keys(ALSO_PLAYS)) assert.ok(order('0.6.0') <= order(older) && order(older) < order(PLAYS_AS), `${older} is older than ${PLAYS_AS}`);
  if (PLAYS_AS === game) return;
  const root = path.join(here, '..');
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `v${PLAYS_AS}^{commit}`], { cwd: root }).status !== 0) {
    t.skip(`no git, or no tag v${PLAYS_AS}, to compare with`);
    return;
  }
  /*
   * ONLINE MODE's page and its waiting room are left out: no match runs them, and their state is
   * each machine's own. So is the attract overlay's intro, which no match plays. The fingerprint and
   * the copies are compared by what they make (below).
   */
  const played = ['src/sim', ':(exclude)src/sim/game/online-page.ts', ':(exclude)src/sim/game/intro.ts', 'src/assets', 'src/net/session.ts', 'src/net/wire.ts'];
  const changed = spawnSync('git', ['diff', '--name-only', `v${PLAYS_AS}`, '--', ...played], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.equal(changed, '', `changed since v${PLAYS_AS}, so this release plays otherwise and PLAYS_AS is to be its own version`);
});

test("the state's fingerprint and copies, nothing left out, are those of the release a match is played as", async (t) => {
  const tagged = releaseCode(PLAYS_AS, ['src/net/snapshot.ts']);
  if (tagged === null) return t.skip(`no git, or no tag v${PLAYS_AS}, to compare with`);
  try {
    const { StateSnapshotter: Tagged } = await tagged.load('src/net/snapshot.ts');
    const data = { table: [1, 2, 3], move: { id: 7, frames: new Int16Array([1, -2]) } };
    const tree = () => ({
      remake: { walls: 1 },
      a: 1,
      b: -0.5,
      c: 'TEXT',
      d: true,
      e: null,
      f: [{ x: 2, y: new Int32Array([3, 4]), z: [5, [6, 7]] }, { x: 8, y: new Int32Array([9, 10]), z: [] }],
      g: { h: new Uint8Array([1, 2, 3, 4, 5]), i: new Float32Array([0.25]), move: data.move },
    });
    for (const own of [[], ['remake']]) {
      const [ours, theirs] = [new StateSnapshotter(tree(), own), new Tagged(tree(), own)];
      ours.share(data);
      theirs.share(data);
      assert.equal(ours.digestNow(), theirs.digestNow(), `the same fingerprint (${own})`);
      const [slotA, slotB] = [ours.create(), theirs.create()];
      ours.save(slotA);
      theirs.save(slotB);
      assert.deepEqual(slotA, slotB, 'the same copy');
      assert.equal(ours.digest(slotA), theirs.digest(slotB));
    }
  } finally {
    tagged.remove();
  }
});

/** Two players paired by the quick match and playing, and each match after on the pairing: played a while, then ended with each side's word on its winner. */
async function pairedPlaying(a, b) {
  a.online.quickMatch();
  await frames([a, b], () => a.online.state === 'queued');
  b.online.quickMatch();
  await frames([a, b], () => a.online.state === 'offered' && b.online.state === 'offered');
  a.online.answer(true);
  b.online.answer(true);
  await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
}
async function playOut(a, b, [saysA, saysB]) {
  await frames([a, b], () => a.online.session?.tick > 30 && b.online.session?.tick > 30, 800);
  assert.ok(a.online.session !== null && b.online.session !== null, `the match played (${a.online.ended} ${b.online.ended})`);
  /* A game that keeps no id ends its match as any does, and says nothing of it to the server. */
  a.online.matchOver(saysA);
  b.online.matchOver(saysB);
  await frames([a, b], () => false, 15);
}
async function rematch(a, b) {
  a.online.rematch(true);
  b.online.rematch(true);
  await frames([a, b], () => a.online.state === 'playing' && b.online.state === 'playing');
}

test("the server counts each player's streak of wins: the winner's one longer, the loser's ended, a draw or two words that differ neither; leaving a match under way ends the leaver's", async () => {
  const { relay, url } = await server();
  const a = side(url, { name: 'A', id: 'a'.repeat(32) });
  const b = side(url, { name: 'B', id: 'b'.repeat(32) });
  const streaks = () => [a.online.wins, b.online.wins, a.online.opponentWins, b.online.opponentWins];
  try {
    await pairedPlaying(a, b);
    assert.deepEqual(streaks(), [0, 0, 0, 0], 'none yet, told at the welcome and the pairing');
    await playOut(a, b, [0, 0]);
    assert.deepEqual(streaks(), [1, 0, 0, 1], "the host won: its streak one, the guest's none, each told the other's");
    await rematch(a, b);
    await playOut(a, b, [0, 0]);
    assert.deepEqual(streaks(), [2, 0, 0, 2]);
    await rematch(a, b);
    await playOut(a, b, [-1, -1]);
    assert.deepEqual(streaks(), [2, 0, 0, 2], 'a draw changes neither');
    await rematch(a, b);
    await playOut(a, b, [0, 1]);
    assert.deepEqual(streaks(), [2, 0, 0, 2], 'two words that differ count for nothing');
    await rematch(a, b);
    await playOut(a, b, [1, 1]);
    assert.deepEqual(streaks(), [0, 1, 1, 0], "the guest won: the host's streak ended");
    await rematch(a, b);
    await frames([a, b], () => b.online.session?.tick > 30, 800);
    b.online.cancel();
    await frames([a, b], () => b.online.wins === 0 && a.online.state === 'lobby');
    assert.equal(b.online.wins, 0, 'left with the match under way: lost');
    assert.equal(a.online.wins, 0, 'the one left behind gains nothing');
    a.online.disconnect();
    const again = side(url, { name: 'A', id: 'b'.repeat(32) });
    again.online.connect();
    await frames([again], () => again.online.state === 'lobby');
    assert.equal(again.online.wins, 0, "a player's streak by their id, told at the welcome");
    again.online.disconnect();
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test("a game that keeps no id (as 0.6.5's) is counted nothing and told nothing, its opponent's word alone settling their match; no id is shown", async () => {
  const { relay, url } = await server();
  const a = side(url, { name: 'NEW', id: 'c'.repeat(32) });
  const b = side(url, { name: 'OLD' });
  try {
    await pairedPlaying(a, b);
    assert.deepEqual([a.online.wins, a.online.opponentWins, b.online.wins], [0, -1, -1], "no streak known for the old game's player, nor one told it");
    await playOut(a, b, [0, undefined]);
    assert.equal(a.online.wins, 1, "the new game's word alone");
    assert.equal(b.online.wins, -1);
    await rematch(a, b);
    await playOut(a, b, [1, undefined]);
    assert.equal(a.online.wins, 0);
    const status = await (await fetch(url.replace('ws:', 'http:') + 'status.json')).text();
    assert.ok(!status.includes('c'.repeat(32)), 'no id in what the server shows');
  } finally {
    for (const one of [a, b]) one.online.disconnect();
    await relay.close();
  }
});

test('the server is versioned with the game', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8')).version;
  assert.equal(JSON.parse(readFileSync(path.join(here, '../server/package.json'), 'utf8')).version, game, 'server/package.json carries the version the game has');
});

test("at a room the host is asked: a no sends the guest away with the reason, the room waiting on", async () => {
  const { relay, url } = await server(['--offer', '1']);
  const [host, guest] = [side(url, { name: 'Host' }), side(url, { name: 'Guest' })];
  try {
    host.online.host(false);
    await frames([host, guest], () => host.online.code !== '');
    const code = host.online.code;
    guest.online.join(code);
    await frames([host, guest], () => host.online.state === 'offered');
    host.online.answer(false);
    await frames([host, guest], () => guest.online.state === 'lobby' && host.online.state === 'hosting');
    assert.equal(guest.online.ended, 'THE OTHER PLAYER SAID NO');
    assert.equal(host.online.state, 'hosting');
    assert.equal(host.online.code, code, 'the same room');
    guest.online.join(code);
    await frames([host, guest], () => guest.online.state === 'offered');
    /* The offer's second, and the seconds an answer may still come in after it. */
    await frames([host, guest], () => guest.online.state === 'lobby', 1200);
    assert.equal(guest.online.ended, 'THE OFFER WAS NOT ANSWERED');
    assert.equal(host.online.state, 'hosting', 'the room waits on');
  } finally {
    host.online.disconnect();
    guest.online.disconnect();
    await relay.close();
  }
});

test('why two players cannot play each other: the version, or a chosen fighter the other lacks, by name; their rosters and data otherwise free to differ', async () => {
  const { cannotPlay, rosterWord } = await import('../src/net/online.ts');
  const names = (fighter) => ['PAUL', 'LAW', 'LEI'][fighter] ?? (fighter === 22 ? 'KAZUYA' : `F${fighter}`);
  const all = rosterWord(EVERY);
  const noKazuya = rosterWord(EVERY.filter((fighter) => fighter !== 22));
  assert.equal(all, '7fffff');
  const us = (fighter, roster = all, version = '0.6.1') => ({ version, roster, fighter });
  assert.equal(cannotPlay(us(0), us(1, all, '0.6.0'), names), 'THE OTHER PLAYER HAS VERSION 0.6.0');
  assert.equal(cannotPlay(us(22), us(0, noKazuya), names), 'THE OTHER PLAYER LACKS KAZUYA');
  assert.equal(cannotPlay(us(0, noKazuya), us(22), names), 'YOU LACK KAZUYA');
  assert.equal(cannotPlay(us(1, noKazuya), us(2), names), '', 'Kazuya on one side only, neither playing him');
  assert.equal(cannotPlay(us(0, rosterWord([0, 1])), us(1, rosterWord([0, 1, 2]))), '', 'any two rosters holding both fighters');
  assert.equal(cannotPlay(us(-1), us(22, noKazuya)), '', 'a fighter not chosen yet asks nothing');
});

test("the server's settings: a file, then the environment, then the command line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-'));
  const file = path.join(dir, 'relay.json');
  writeFileSync(file, JSON.stringify({ port: 9000, name: 'FROM FILE', maxRooms: 3, origins: ['https://a.example'] }));
  const config = readConfig(['--config', file, '--max-rooms', '7'], { T3_RELAY_NAME: 'FROM ENV', T3_RELAY_ICE: '[]' });
  assert.equal(config.port, 9000);
  assert.equal(config.name, 'FROM ENV');
  assert.equal(config.maxRooms, 7);
  assert.deepEqual(config.origins, ['https://a.example']);
  assert.deepEqual(config.ice, []);
  assert.throws(() => readConfig(['--nope', '1'], {}), /unknown setting/);
  assert.throws(() => readConfig(['--cert', 'a.pem'], {}), /cert and key/);
});

test('the server answers its health check, and refuses an origin it does not allow', async () => {
  const { relay, url } = await server(['--origins', 'https://allowed.example']);
  try {
    const health = await fetch(url.replace('ws:', 'http:') + 'health').then((r) => r.text());
    assert.match(health, /^ok clients=0 rooms=0 queued=0/);
    const refused = await new Promise((resolve) => {
      const socket = new WebSocket(url, { origin: 'https://other.example' });
      socket.on('error', () => resolve(true));
      socket.on('open', () => resolve(false));
    });
    assert.equal(refused, true);
  } finally {
    await relay.close();
  }
});
