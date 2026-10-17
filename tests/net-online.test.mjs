/**
 * Online play end to end on this machine: the server (`server/relay.mjs`) on a free port, and two
 * players' sides over real WebSockets, each playing a small made-up game: a quick match pairs them
 * and they play the same game; a room hosted is joined by its code, and listed in the room list
 * while it waits; players are paired whatever fighters each has, unless one chose a fighter the
 * other lacks, and another version is refused; a player leaving ends the other's
 * match; a match over asks both for a rematch; the server's counts are told, and a way to it that fails gives way to the next; its page for a browser says how busy it is and how to play on it; the server's settings come from a file, the environment and the command line in turn.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

import { Relay, readConfig } from '../server/relay.mjs';
import { Online } from '../src/net/online.ts';
import { StateSnapshotter } from '../src/net/snapshot.ts';

const quiet = { log: () => {} };

async function server(settings = []) {
  const relay = new Relay(readConfig(['--host', '127.0.0.1', '--port', '0', ...settings], {}), quiet);
  const port = await relay.listen();
  return { relay, url: `ws://127.0.0.1:${port}/` };
}

/** Every roster id, Kazuya's (22) among them. */
const EVERY = Array.from({ length: 23 }, (_, i) => i);

/** A side: its made-up game (its version, the fighters whose data it has), the fighter it chose (`pick` changes it), and what began and ended. */
/** The game's own button setup as it powers on (each of the pad's eight buttons an entry of its table of thirteen; 12 none), and one of a player's own. */
const DEFAULT_KEYS = [12, 12, 12, 12, 1, 3, 2, 0];
const OWN_KEYS = [12, 12, 12, 12, 0, 1, 2, 3];

function side(url, { version = '0.6.1', roster = EVERY, fighter = 0, name = 'A', delay = 2, now, keys = DEFAULT_KEYS } = {}) {
  const chosen = { fighter };
  const log = { began: null, ended: null, begun: 0, waited: 0 };
  const state = { at: [0, 0], mix: 1, fields: 0 };
  const game = {
    version,
    roster,
    keyChoices: 13,
    defaultKeys: DEFAULT_KEYS,
    options: () => ({ rounds: 3 }),
    begin(start, seat) {
      log.began = { start, seat };
      log.begun += 1;
      /* Every match from the same start, as the game's own begins from the state it powers on with. */
      Object.assign(state, { at: [0, 0], mix: 1, fields: 0 });
      return {
        step: ([a, b]) => {
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
  const online = new Online({ url: () => url, game, player: () => ({ name, delay, keys, fighter: { roster: chosen.fighter, costume: 0 } }), open: (at) => new WebSocket(at), peerConnection: null, now });
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
    await frames([host, guest], () => guest.online.state === 'lobby', 400);
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
