/**
 * The online matches' server: it finds two players each other and passes their messages between
 * them, and nothing else. Each player's game runs on their own machine from their own disc; what
 * goes through here is the pads' words, the match's setup and the connection's own messages, never
 * any of the game's data.
 *
 * A player says hello (their game's version, the fighters whose data they have), then hosts a room
 * (a code to give the other player, listed in the server's room list or not, with a password or
 * not), joins one by its code, or waits in the quick match's queue, each with the fighter they
 * chose. Two players are brought together only where they can play each other: the same version,
 * and each one's fighter one whose data the other has. Two players the queue brings together, or
 * a room's host and the player joining it, are offered each other first: both must say yes within
 * the offer's seconds. In the queue a no puts both back in it, kept apart from each other a while, and
 * an offer not answered in time puts both back to look again; at a room a no or no answer sends the
 * guest away, the room waiting on. Two players in a room are paired: text messages between them
 * (`peer`) and binary ones (the pads' words) are passed on as they are, until one leaves (a quick
 * match's two, leaving it without a rematch, kept apart a while too). The players try to reach
 * each other directly (WebRTC) and use this only for what they cannot; the servers they ask for
 * that (STUN, TURN) are told them in the welcome. Each player's streak of matches won is kept here,
 * in memory, by the id their game sends at its hello: the games say who won each match, and leaving
 * one under way loses it.
 *
 *   node server/relay.mjs [--config file.json] [--host 0.0.0.0] [--port 8790] [--path /] ...
 *
 * Every setting is read from `--config`'s JSON file, then the environment (`T3_RELAY_<NAME>`),
 * then the command line (`--<name>`), each over the one before; `--help` lists them.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { WebSocketServer } from 'ws';

import { panelPage } from './panel.mjs';

/** The protocol's version: a client speaking another is refused at its hello. */
export const PROTOCOL = 1;
/** The game a client must say it is. */
const GAME = 'tekken3';

/** Seconds two players who said no to each other are kept apart. */
const APART_SECONDS = 120;
/** Seconds a match's result waits for the second player's word on it, once the first has said it. */
const RESULT_SECONDS = 15;
/** Hours a player's streak of wins is kept after they were last on the server. */
const STREAK_HOURS = 24;
/** A player's own id, as their game makes it: hex digits, kept by the game between visits. */
const OWN_ID = /^[0-9a-f]{16,64}$/;

/** Room codes: letters and digits that read and sound unlike each other. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** The settings, their kinds and defaults, and what each one is. */
export const SETTINGS = {
  host: { kind: 'string', default: '0.0.0.0', about: 'the address to listen on' },
  port: { kind: 'number', default: 8790, about: 'the port to listen on' },
  path: { kind: 'string', default: '/', about: "the WebSocket's path" },
  name: { kind: 'string', default: 'TEKKEN 3 SERVER', about: 'the name players are shown' },
  motd: { kind: 'string', default: '', about: 'a line players are shown on connecting' },
  cert: { kind: 'string', default: '', about: "a TLS certificate's file (PEM): with key, the server speaks wss" },
  key: { kind: 'string', default: '', about: "the TLS certificate's key file (PEM)" },
  origins: { kind: 'list', default: [], about: 'the page origins allowed to connect, comma separated (none: any)' },
  ice: { kind: 'json', default: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], about: 'the ICE servers told to players, as RTCIceServer JSON ([] for none: always through this server)' },
  maxClients: { kind: 'number', default: 500, about: 'the most players connected at once' },
  maxRooms: { kind: 'number', default: 200, about: 'the most rooms open at once' },
  listed: { kind: 'number', default: 50, about: 'the most rooms the room list shows' },
  offer: { kind: 'number', default: 10, about: "seconds two players the quick match brings together have to say yes" },
  idle: { kind: 'number', default: 300, about: 'seconds a player may say nothing before being let go' },
  rate: { kind: 'number', default: 400, about: 'the most messages a second a player may send' },
  maxMessage: { kind: 'number', default: 16384, about: "a message's most bytes" },
};

/** A player as the log names them: their name and the address they connect from (and, behind a proxy, the one it forwards for them). */
const who = (client) => `${client.name} (${client.address})`;

function addressOf(request) {
  const remote = (request?.socket?.remoteAddress ?? '?').replace(/^::ffff:/, '');
  const forwarded = String(request?.headers?.['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return forwarded ? `${forwarded} via ${remote}` : remote;
}

/** Two players' pair, whichever way round. */
/** The server's own version (its package's, kept with the game's), and the oldest game version that speaks its protocol. */
const SERVER_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '?';
const OLDEST_GAME = '0.6.0';

/** The game's two faces its page is set in, each by the file its package keeps it in (read once, none where the package is not installed). */
const FONTS = {
  'russo-one.woff2': ['@fontsource/russo-one', 'russo-one-latin-400-normal.woff2'],
  'saira-500.woff2': ['@fontsource/saira-extra-condensed', 'saira-extra-condensed-latin-500-normal.woff2'],
  'saira-900.woff2': ['@fontsource/saira-extra-condensed', 'saira-extra-condensed-latin-900-normal.woff2'],
};
const fonts = new Map();
const require = createRequire(import.meta.url);
function fontFile(name) {
  if (!fonts.has(name)) {
    const [pkg, file] = FONTS[name] ?? [];
    let bytes = null;
    try {
      if (pkg !== undefined) bytes = readFileSync(path.join(path.dirname(require.resolve(`${pkg}/LICENSE`)), 'files', file));
    } catch {
      bytes = null;
    }
    fonts.set(name, bytes);
  }
  return fonts.get(name);
}

const pairKey = (a, b) => (a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`);

/** The fighters whose data a player has, from the word their hello carries (a bit a roster id, in hex). */
function rosterOf(word) {
  try {
    return typeof word === 'string' && /^[0-9a-f]{1,64}$/i.test(word) ? BigInt(`0x${word}`) : 0n;
  } catch {
    return 0n;
  }
}

/** Whether a player has this fighter's data (any, for no fighter chosen). */
const hasFighter = (client, fighter) => fighter < 0 || ((client.roster >> BigInt(fighter)) & 1n) === 1n;

/**
 * Whether two players can play each other: the same version of the game, and each one's chosen
 * fighter one whose data the other has. Their rosters and their games' data may differ otherwise.
 */
const compatible = (a, b) => a.build === b.build && hasFighter(b, a.fighter) && hasFighter(a, b.fighter);

/** A player as another is told of them on a refusal, to say why. */
const sideOf = (client) => ({ version: client.build, roster: client.roster.toString(16), fighter: client.fighter });

const flag = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const envName = (name) => `T3_RELAY_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

function parseSetting(name, raw) {
  const { kind } = SETTINGS[name];
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name}: not a number (${raw})`);
    return n;
  }
  if (kind === 'list') return Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (kind === 'json') return typeof raw === 'string' ? JSON.parse(raw) : raw;
  return String(raw);
}

/** The settings from a config file, the environment and the command line, each over the one before. */
export function readConfig(argv = process.argv.slice(2), env = process.env) {
  const config = Object.fromEntries(Object.entries(SETTINGS).map(([name, s]) => [name, s.default]));
  const cli = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('--')) throw new Error(`unknown argument ${arg}`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inline ?? argv[(i += 1)];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    cli.set(key, value);
  }
  const file = cli.get('config') ?? env.T3_RELAY_CONFIG;
  if (file !== undefined) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, value] of Object.entries(json)) {
      if (!(name in SETTINGS)) throw new Error(`${file}: unknown setting ${name}`);
      config[name] = parseSetting(name, value);
    }
  }
  for (const name of Object.keys(SETTINGS)) {
    const value = env[envName(name)];
    if (value !== undefined && value !== '') config[name] = parseSetting(name, value);
  }
  for (const [key, value] of cli) {
    if (key === 'config') continue;
    const name = Object.keys(SETTINGS).find((n) => flag(n) === key);
    if (name === undefined) throw new Error(`unknown setting --${key}`);
    config[name] = parseSetting(name, value);
  }
  if ((config.cert === '') !== (config.key === '')) throw new Error('cert and key go together');
  return config;
}

function usage() {
  const lines = Object.entries(SETTINGS).map(([name, s]) => `  --${flag(name).padEnd(13)} ${envName(name).padEnd(24)} ${s.about} (default ${JSON.stringify(s.default)})`);
  return ['node server/relay.mjs [--config file.json] [settings]', '', '  setting        environment              ', ...lines, '', 'A config file is a JSON object of the same settings by name (maxClients, not max-clients).'].join('\n');
}

/** A name as players are shown it: up to twelve letters, digits and spaces, upper case. */
/** The fighter a command says its player chose (a roster id), or -1. */
const fighterOf = (raw) => (Number.isInteger(raw) && 0 <= raw && raw < 64 ? raw : -1);
const cleanName = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').trim().slice(0, 12) || 'PLAYER';
const cleanTitle = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9 .\-!?']/g, '').trim().slice(0, 20);

/**
 * The server: `listen()` opens it, `close()` shuts it. `now` is the clock for idleness and rates
 * (supplied so a test can move it).
 */
export class Relay {
  constructor(config, { now = () => Date.now(), log = (line) => console.log(line) } = {}) {
    /** When it started, for its page's time up. */
    this.started = now();
    this.config = config;
    this.now = now;
    this.log = log;
    /** Every connected player. */
    this.clients = new Set();
    /** Rooms by code. */
    this.rooms = new Map();
    /** The quick match's queue, oldest first. */
    this.queue = [];
    /** The queue's offers waiting for their answers, and the pairs kept apart (by their ids) until when. */
    this.offers = new Set();
    this.apart = new Map();
    this.ids = 0;
    /**
     * Each player's streak of matches won without a loss, by the id their game keeps (a game that
     * sends none has none), and when they were last on the server: kept here alone, and lost as the
     * server stops.
     */
    this.streaks = new Map();
  }

  /** Its own server, on the configured address: plain, or TLS with a certificate. */
  listen() {
    const { config } = this;
    const tls = config.cert !== '' ? { cert: readFileSync(config.cert), key: readFileSync(config.key) } : null;
    const respond = (request, response) => this.http(request, response);
    this.server = tls === null ? createHttp(respond) : createHttps(tls, respond);
    this.attach(this.server, config.path);
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(config.port, config.host, () => {
        const { port } = this.server.address();
        this.port = port;
        this.log(`[relay] ${config.name} on ${tls === null ? 'ws' : 'wss'}://${config.host}:${port}${config.path}`);
        resolve(port);
      });
    });
  }

  /** On another HTTP server's upgrades to `path` (the dev server's `/relay`), leaving the rest to it. */
  attach(server, path) {
    const { config } = this;
    /** The path its players' WebSockets come to, which its page tells them. */
    this.path = path;
    this.sockets = new WebSocketServer({ noServer: true, maxPayload: config.maxMessage });
    this.sockets.on('connection', (socket, request) => this.connected(socket, request));
    this.sweeper = setInterval(() => this.sweep(), 5000);
    this.offering = setInterval(() => this.expireOffers(), 250);
    server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://relay').pathname !== path) return;
      const origin = request.headers.origin ?? '';
      const refuse = config.origins.length > 0 && !config.origins.includes(origin) ? '403 Forbidden' : this.clients.size >= config.maxClients ? '503 Service Unavailable' : null;
      if (refuse !== null) {
        socket.end(`HTTP/1.1 ${refuse}\r\n\r\n`);
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.sockets.emit('connection', ws, request));
    });
  }

  /** Every player let go and the server shut, its open connections cut rather than waited for. */
  close() {
    clearInterval(this.sweeper);
    clearInterval(this.offering);
    for (const client of this.clients) client.socket.terminate();
    this.sockets?.close();
    if (this.server === undefined) return Promise.resolve();
    const closed = new Promise((resolve) => this.server.close(() => resolve()));
    this.server.closeAllConnections?.();
    return closed;
  }

  /**
   * Its HTTP answers: `GET /health`, whether it is up and how busy; `GET /status.json`, the numbers
   * its page shows (`status`); its page itself on its own path (`panel.mjs`). Behind another server
   * (the dev server's `/relay`), the path the request came on (`originalUrl`) is the page's own.
   */
  http(request, response) {
    const url = new URL(request.url ?? '/', 'http://relay');
    const own = new URL(request.originalUrl ?? request.url ?? '/', 'http://relay').pathname;
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      response.end(`ok clients=${this.clients.size} rooms=${this.rooms.size} queued=${this.queue.length}\n`);
      return;
    }
    const font = /\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
    if (font !== null) {
      const bytes = fontFile(font[1]);
      response.writeHead(bytes === null ? 404 : 200, bytes === null ? { 'content-type': 'text/plain' } : { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=86400' });
      response.end(bytes ?? 'no such font\n');
      return;
    }
    if (url.pathname.endsWith('/status.json')) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      response.end(JSON.stringify(this.status()));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === this.path) {
      const base = own.endsWith('/') ? own : own.endsWith('/index.html') ? own.slice(0, -'index.html'.length) : `${own}/`;
      const secure = request.socket.encrypted === true || String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim() === 'https';
      const wsPath = this.path === undefined || this.path === '/' ? '' : this.path;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(panelPage({ root: base, address: `${secure ? 'wss' : 'ws'}://${request.headers.host ?? `localhost:${this.port ?? this.config.port}`}${wsPath}` }));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`${this.config.name}: a server for Tekken 3's online matches; its page is at /.\n`);
  }

  /**
   * What its page shows, no player's address among it: its name and line, its own version and the
   * oldest game version it serves, the players on it, the fights on now, the quick match's queue,
   * the rooms waiting (and those listed, by title, host and version), the versions being played,
   * and the seconds it has been up.
   */
  status() {
    let fights = 0;
    let waiting = 0;
    const listed = [];
    for (const room of this.rooms.values()) {
      if (room.seats[1] !== null) fights += 1;
      else if (!room.quick) {
        waiting += 1;
        if (room.listed && room.offering === null) listed.push({ title: room.title, host: room.seats[0].name, version: room.seats[0].build });
      }
    }
    const versions = {};
    for (const client of this.clients) if (client.hello) versions[client.build] = (versions[client.build] ?? 0) + 1;
    return { name: this.config.name, motd: this.config.motd, version: SERVER_VERSION, oldest: OLDEST_GAME, protocol: PROTOCOL, ...this.counts(), fights, rooms: waiting, listed: listed.slice(0, this.config.listed), versions, up: Math.floor((this.now() - this.started) / 1000) };
  }

  connected(socket, request) {
    const client = { id: (this.ids += 1), address: addressOf(request), offer: null, socket, hello: false, name: 'PLAYER', build: '', own: '', roster: 0n, fighter: -1, room: null, seat: -1, queued: false, heard: this.now(), window: this.now(), count: 0, alive: true };
    this.clients.add(client);
    socket.on('pong', () => (client.alive = true));
    socket.on('message', (data, binary) => this.message(client, data, binary));
    socket.on('close', () => this.gone(client));
    socket.on('error', () => socket.terminate());
  }

  message(client, data, binary) {
    const now = this.now();
    client.heard = now;
    if (now - client.window >= 1000) {
      client.window = now;
      client.count = 0;
    }
    client.count += 1;
    if (client.count > this.config.rate) {
      client.socket.close(1008, 'too many messages');
      return;
    }
    if (binary) {
      const other = this.partner(client);
      if (other !== null && other.socket.readyState === 1) other.socket.send(data, { binary: true });
      return;
    }
    let command;
    try {
      command = JSON.parse(String(data));
    } catch {
      return this.tell(client, { ev: 'error', why: 'not json' });
    }
    if (command === null || typeof command !== 'object' || typeof command.do !== 'string') return this.tell(client, { ev: 'error', why: 'no command' });
    if (!client.hello && command.do !== 'hello') return this.tell(client, { ev: 'error', why: 'hello first' });
    switch (command.do) {
      case 'hello':
        return this.hello(client, command);
      case 'host':
        client.fighter = fighterOf(command.fighter);
        return this.host(client, command);
      case 'join':
        client.fighter = fighterOf(command.fighter);
        return this.join(client, command);
      case 'queue':
        client.fighter = fighterOf(command.fighter);
        return this.enqueue(client);
      case 'answer':
        return this.answer(client, command.yes === true);
      case 'unqueue':
      case 'leave':
        return this.leave(client, 'left', command.apart === true);
      case 'rooms':
        return this.list(client);
      case 'peer': {
        const other = this.partner(client);
        if (other === null) return;
        /* The host's start: a match under way on the pairing, by its number. */
        const body = command.body;
        if (client.seat === 0 && body !== null && typeof body === 'object' && body.k === 'start' && Number.isInteger(body.match)) this.underway(client.room, body.match);
        this.tell(other, { ev: 'peer', body: body ?? null });
        return;
      }
      case 'result':
        return this.result(client, command);
      case 'ping':
        return this.tell(client, { ev: 'pong', t: command.t ?? 0, ...this.counts() });
      default:
        return this.tell(client, { ev: 'error', why: `no command ${command.do}` });
    }
  }

  hello(client, { game, protocol, name, build, roster, id }) {
    if (game !== GAME || protocol !== PROTOCOL) {
      this.tell(client, { ev: 'refused', why: protocol !== PROTOCOL ? 'protocol' : 'game' });
      client.socket.close(1008, 'refused');
      return;
    }
    client.hello = true;
    client.name = cleanName(name);
    client.build = String(build ?? '').slice(0, 64);
    client.own = typeof id === 'string' && OWN_ID.test(id) ? id : '';
    client.roster = rosterOf(roster);
    this.log(`[relay] ${who(client)} connected (${this.clients.size} on the server)`);
    /* Its streak to a game that keeps an id, which so learns the server counts them. */
    this.tell(client, { ev: 'welcome', name: this.config.name, motd: this.config.motd, ice: this.config.ice, protocol: PROTOCOL, rooms: this.rooms.size, ...this.counts(), ...(client.own === '' ? {} : { wins: this.winsOf(client) }) });
  }

  /** A player's streak of wins (0 for one whose game keeps no id). */
  winsOf(client) {
    return client.own === '' ? 0 : (this.streaks.get(client.own)?.wins ?? 0);
  }

  /** A player's streak set (where their game keeps an id), the time they were last seen with it. */
  setWins(client, wins) {
    if (client.own !== '') this.streaks.set(client.own, { wins, seen: this.now() });
  }

  /** Each player of a pairing told their streak and the other's (a game that keeps no id told nothing, and its player's streak not given). */
  tellWins(room) {
    room.seats.forEach((one, seat) => {
      const other = room.seats[1 - seat];
      if (one !== null && one.own !== '') this.tell(one, { ev: 'wins', wins: this.winsOf(one), ...(other?.own ? { peer: this.winsOf(other) } : {}) });
    });
  }

  /** A match begun on a pairing (its number): under way until its result is said. */
  underway(room, match) {
    if (room === null) return;
    room.match = { number: match, said: [null, null], until: 0 };
  }

  /**
   * A player's word on the match's result: the seat that won it (-1 a draw). Settled once both have
   * said it, or once one has where the other's game says no results (it keeps no id) or the other
   * says nothing in time.
   */
  result(client, { match, winner }) {
    const room = client.room;
    const under = room?.match;
    if (under == null || under.number !== match || client.own === '' || ![-1, 0, 1].includes(winner)) return;
    under.said[client.seat] = winner;
    const other = this.partner(client);
    if (under.said.every((one) => one !== null) || other === null || other.own === '') this.settleMatch(room);
    else if (under.until === 0) under.until = this.now() + RESULT_SECONDS * 1000;
  }

  /**
   * A match's result as its players said it: the winner's streak one longer and the loser's ended (a
   * draw neither), unless the two said otherwise of it, which counts for nothing. Both told.
   */
  settleMatch(room) {
    const under = room.match;
    if (under == null) return;
    room.match = null;
    const said = under.said.filter((one) => one !== null);
    if (said.length === 0 || said.some((one) => one !== said[0])) return;
    const winner = said[0];
    if (winner === -1) return;
    const [won, lost] = [room.seats[winner], room.seats[1 - winner]];
    if (won !== null) this.setWins(won, this.winsOf(won) + 1);
    if (lost !== null) this.setWins(lost, 0);
    this.log(`[relay] ${room.quick ? 'quick match' : `room ${room.code}`} match ${under.number}: ${won === null ? '?' : who(won)} won`);
    this.tellWins(room);
  }

  /** The players on the server (those who said hello) and those waiting in its quick match, told with each pong so a page can say how many are about. */
  counts() {
    let players = 0;
    for (const client of this.clients) if (client.hello) players += 1;
    return { players, queued: this.queue.length };
  }

  /** A room of this player's own, waiting for another: listed or not, with a password or not. */
  host(client, { listed, title, pass }) {
    this.leave(client, 'left');
    if (this.rooms.size >= this.config.maxRooms) return this.tell(client, { ev: 'refused', why: 'busy' });
    let code;
    do code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.rooms.has(code));
    const room = { code, listed: listed === true, title: cleanTitle(title) || `${client.name}'S ROOM`, pass: typeof pass === 'string' ? pass.slice(0, 32) : '', seats: [client, null], quick: false, offering: null, match: null };
    this.rooms.set(code, room);
    client.room = room;
    client.seat = 0;
    this.tell(client, { ev: 'hosting', code, listed: room.listed });
  }

  join(client, { code, pass }) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (room === undefined || room.quick) return this.tell(client, { ev: 'refused', why: 'no room' });
    if (room.seats[0] === client) return this.tell(client, { ev: 'refused', why: 'own room' });
    if (room.seats[1] !== null || room.offering !== null) return this.tell(client, { ev: 'refused', why: 'full' });
    if (room.pass !== '' && room.pass !== pass) return this.tell(client, { ev: 'refused', why: 'password' });
    if (!compatible(room.seats[0], client)) return this.tell(client, { ev: 'refused', why: 'different game', theirs: sideOf(room.seats[0]) });
    this.leave(client, 'left');
    this.offer(room.seats[0], client, room);
  }

  enqueue(client) {
    this.leave(client, 'left');
    const now = this.now();
    const other = this.queue.find((one) => compatible(one, client) && !(now < (this.apart.get(pairKey(one, client)) ?? 0)));
    if (other === undefined) {
      this.queue.push(client);
      client.queued = true;
      this.tell(client, { ev: 'queued', waiting: this.queue.length });
      return;
    }
    this.queue.splice(this.queue.indexOf(other), 1);
    other.queued = false;
    this.offer(other, client, null);
  }

  /** Two players offered each other (the first the host), from the queue or at a room (`room`, held for them meanwhile). */
  offer(first, second, room) {
    const offer = { players: [first, second], answers: [null, null], until: this.now() + this.config.offer * 1000, room };
    this.offers.add(offer);
    first.offer = offer;
    second.offer = offer;
    if (room !== null) room.offering = offer;
    this.log(`[relay] ${room === null ? 'quick match' : `room ${room.code}`} offered: ${who(first)} and ${who(second)}`);
    this.tell(first, { ev: 'offer', peer: { name: second.name }, seconds: this.config.offer });
    this.tell(second, { ev: 'offer', peer: { name: first.name }, seconds: this.config.offer });
  }

  /** A player's answer to the queue's offer: both yes, a quick match's room; a no, both back in the queue. */
  answer(client, yes) {
    const offer = client.offer;
    if (offer === null) return;
    const at = offer.players.indexOf(client);
    if (offer.answers[at] !== null) return;
    offer.answers[at] = yes;
    if (!yes) this.settle(offer, 'declined');
    else if (offer.answers.every((one) => one === true)) this.settle(offer, 'accepted');
  }

  /**
   * An offer over. Accepted, the two seated (in a room of their own from the queue). From the
   * queue: declined, both queued again and kept apart a while; run out, both queued again to look
   * again; one gone, the other queued again. At a room: the guest sent away (but gone), the host's
   * room waiting on (but gone).
   */
  settle(offer, how, gone = null) {
    this.offers.delete(offer);
    for (const one of offer.players) one.offer = null;
    const [first, second] = offer.players;
    const room = offer.room;
    if (room !== null) {
      room.offering = null;
      if (how === 'accepted') return this.seat(room, second);
      if (second !== gone) this.tell(second, { ev: 'refused', why: how === 'gone' ? 'left' : how === 'declined' ? 'declined' : 'no answer' });
      if (first !== gone) this.tell(first, { ev: 'hosting', code: room.code, listed: room.listed });
      return;
    }
    if (how === 'accepted') {
      let code;
      do code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      while (this.rooms.has(code));
      const room = { code, listed: false, title: '', pass: '', seats: [first, null], quick: true, offering: null, match: null };
      this.rooms.set(code, room);
      first.room = room;
      first.seat = 0;
      this.seat(room, second);
      return;
    }
    if (how === 'declined') this.apart.set(pairKey(first, second), this.now() + APART_SECONDS * 1000);
    for (const one of offer.players) if (one !== gone) this.enqueue(one);
  }

  /** The offers whose time is up. */
  expireOffers() {
    const now = this.now();
    for (const offer of [...this.offers]) if (offer.until <= now) this.settle(offer, 'expired');
    for (const room of this.rooms.values()) if (room.match != null && room.match.until !== 0 && room.match.until <= now) this.settleMatch(room);
    for (const [key, until] of this.apart) if (until <= now) this.apart.delete(key);
  }

  /** The second player seated: both told who the other is and which side they play. */
  seat(room, client) {
    room.seats[1] = client;
    client.room = room;
    client.seat = 1;
    const [first, second] = room.seats;
    const peer = (one) => ({ name: one.name, ...(one.own === '' ? {} : { wins: this.winsOf(one) }) });
    this.tell(first, { ev: 'paired', seat: 0, code: room.code, peer: peer(second) });
    this.tell(second, { ev: 'paired', seat: 1, code: room.code, peer: peer(first) });
    this.log(`[relay] ${room.quick ? 'quick match' : `room ${room.code}`}: ${who(first)} and ${who(second)}`);
  }

  list(client) {
    const rooms = [...this.rooms.values()]
      .filter((room) => room.listed && room.seats[1] === null && room.offering === null)
      .slice(0, this.config.listed)
      .map((room) => ({ code: room.code, title: room.title, host: room.seats[0].name, locked: room.pass !== '', same: room.seats[0].build === client.build && hasFighter(client, room.seats[0].fighter) }));
    this.tell(client, { ev: 'rooms', rooms });
  }

  /**
   * This player out of the queue and out of their room, which closes: the other player in it told,
   * and back in the lobby too; `apart`, a quick match's two kept apart a while (no rematch).
   */
  leave(client, why, apart = false) {
    if (client.queued) {
      this.queue.splice(this.queue.indexOf(client), 1);
      client.queued = false;
    }
    if (client.offer !== null) this.settle(client.offer, 'gone', client);
    const room = client.room;
    if (room === null) return;
    /* Left with a match under way that neither has said is over: lost, for the one who left; said over by one, settled as said. */
    if (room.match != null) {
      if (room.match.said.every((one) => one === null)) {
        this.setWins(client, 0);
        room.match = null;
        if (client.own !== '') this.tell(client, { ev: 'wins', wins: 0 });
      } else this.settleMatch(room);
    }
    this.rooms.delete(room.code);
    if (apart && room.quick && room.seats[0] !== null && room.seats[1] !== null) this.apart.set(pairKey(room.seats[0], room.seats[1]), this.now() + APART_SECONDS * 1000);
    for (const one of room.seats) {
      if (one === null) continue;
      one.room = null;
      one.seat = -1;
      if (one !== client) this.tell(one, { ev: 'left', why });
    }
  }

  gone(client) {
    this.leave(client, 'gone');
    this.clients.delete(client);
    if (client.hello) this.log(`[relay] ${who(client)} left`);
  }

  partner(client) {
    const room = client.room;
    if (room === null) return null;
    return room.seats[client.seat === 0 ? 1 : 0] ?? null;
  }

  tell(client, event) {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(event));
  }

  /** Every five seconds: a player silent too long let go, a socket that stopped answering ended. */
  sweep() {
    const now = this.now();
    for (const client of this.clients) {
      if (!client.alive || now - client.heard > this.config.idle * 1000) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
    const on = new Set([...this.clients].map((client) => client.own));
    for (const [own, streak] of this.streaks) if (!on.has(own) && now - streak.seen > STREAK_HOURS * 3600 * 1000) this.streaks.delete(own);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(`[relay] ${error.message}\n\n${usage()}`);
    process.exit(2);
  }
  if (config.help) {
    console.log(usage());
    process.exit(0);
  }
  const relay = new Relay(config);
  relay.listen().catch((error) => {
    console.error(`[relay] ${error.message}`);
    process.exit(1);
  });
  /* Stopped at once: a second signal, or a second gone by, ends it whatever is still closing. */
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (stopping) process.exit(130);
      stopping = true;
      console.log('[relay] stopping');
      setTimeout(() => process.exit(0), 1000).unref();
      void relay.close().then(() => process.exit(0));
    });
  }
}
