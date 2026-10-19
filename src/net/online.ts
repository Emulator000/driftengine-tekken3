/**
 * Playing online, from connecting to the server to the end of a match: the lobby (a quick match's
 * queue, a room hosted with its code, listed or not, a room joined by its code or from the list),
 * then, paired, the two players' hellos (the versions their games play as must be the same,
 * `PLAYS_AS`, each asks for an input delay and brings its own buttons), the host's start (the match's options, the
 * delay, both players' buttons) and the match itself (`MatchSession`), its words through the server
 * until the direct connection opens. The game it plays is the caller's (`OnlineGame`): this knows
 * the server, the other player and the session, and nothing of the game or the page.
 */
import { WebSocketTransport } from '@driftengine/network';
import type { MessageSink, PeerId, Snapshotter, Transport, TransportState } from '@driftengine/network';

import { Peering, browserPeerConnection, switchableSocket } from './peering.ts';
import type { ChannelLike, PeerLike, SignalKind, SwitchableSocket } from './peering.ts';
import { GAME, PROTOCOL, RelayClient } from './relay.ts';
import type { ListedFight, ListedRoom, ServerEvent, SocketLike } from './relay.ts';
import { DEFAULT_INPUT_DELAY, MatchSession } from './session.ts';
import type { ConnectionQuality, SessionState } from './session.ts';

/** Where this side is: each is a line a player can be shown. */
export type OnlineState = 'off' | 'connecting' | 'lobby' | 'queued' | 'offered' | 'hosting' | 'joining' | 'greeting' | 'playing' | 'result' | 'ended' | 'watching';

/** What a side says of itself once paired. */
export interface Hello {
  readonly k: 'hello';
  /** The version the match is played as, which must be the other's, and the fighters whose data this side has (`rosterWord`). */
  readonly version: string;
  readonly roster: string;
  readonly name: string;
  /** The input delay asked for, in fields. */
  readonly delay: number;
  /** This player's own button configuration. */
  readonly keys: readonly number[];
  /** The fighter this player chose (its roster id and costume). */
  readonly fighter: Fighter;
  /**
   * Whether this side starts each fight with the other: once ready on the fight's last loading
   * field it says so (`ready`) and holds there until the other has said so too. Absent from an
   * older version's hello, which neither says nor waits for it.
   */
  readonly together?: boolean;
  /**
   * Whether this side plays a match whose level round (a double knockout, or time up with health
   * alike) brings both to the rounds that win it as a draw, rather than as the game's own tie-break
   * has it (the side on a streak, online the host's always). Absent from an older version's hello:
   * the match is then played by the old rule.
   */
  readonly draws?: boolean;
  /**
   * The side this player asks to see their fighter on (0 the left, 1 the right): where the seat the
   * server gave them is the other, they see the fight from the other side. Absent from an older
   * version's hello, whose moves into the screen go by the game's view whatever its player sees.
   */
  readonly side?: number;
  /**
   * Whether this side says it is ready on every fight's last loading field, and while it loads says
   * so by the clock as well as by its frames: the other then holds for that word as long as it
   * hears from it, however long the loading takes. Absent from an older version's hello: one that
   * says nothing for a few seconds is taken to have gone into the fight.
   */
  readonly saysReady?: boolean;
  /**
   * The fighters' packs this side draws with the arcade board's models, whose own accessories its
   * fight swings (`rosterWord`), and their accessories' fingerprint; '0' none. A match keeps them
   * only where both sides say the same (`ownBoard`). Absent from an older version's hello.
   */
  readonly board?: string;
}

/**
 * A fight watched, as the server gives it: its room's code, its match's start and number, the
 * version it is played as, its players' names and streaks (the host's first), and each side's
 * presses so far, by field from the match's first.
 */
export interface Tape {
  readonly code: string;
  readonly match: number;
  readonly start: Start;
  readonly as: string;
  readonly names: readonly [string, string];
  readonly wins: readonly [number, number];
  readonly words: readonly [number[], number[]];
}

/** A fighter chosen: its roster id and its costume. */
export interface Fighter {
  readonly roster: number;
  readonly costume: number;
}

/** What the host decides and the guest is told: the match's options (its stage drawn among them), the delay, both players' buttons and fighters, the host's first. */
export interface Start {
  readonly k: 'start';
  readonly options: Readonly<Record<string, unknown>>;
  readonly delay: number;
  readonly keys: readonly [readonly number[], readonly number[]];
  readonly fighters: readonly [Fighter, Fighter];
  /** The match's number on this pairing: one, then one more for each rematch (`MatchSession`'s `match`). */
  readonly match: number;
  /** 1 where both sides said they play a level match point as a draw (`Hello`'s `draws`): the match is played so. */
  readonly draws?: number;
  /** A bit a seat (the host's 1): its player sees the fight from the other side (`Hello`'s `side`), its moves into the screen going by that view. Absent where none does or a side said nothing of its side. */
  readonly turned?: number;
  /** The board's fighters both sides swing (`Hello`'s `board`), for one watching the match: absent where they swing the disc's. */
  readonly board?: string;
}

/** The game an online match plays, as the page gives it. */
export interface OnlineGame<S> {
  /** The game's version, which both sides must share, but where both play one of `plays`. */
  readonly version: string;
  /** The older versions it also plays a match as, newest first: the server pairs it with their players too, the match played as the newest the two share. */
  readonly plays?: readonly string[];
  /** The fighters whose data this side has, by roster id: the other's chosen fighter must be one of them. */
  readonly roster: readonly number[];
  /** A fighter's name, for saying which one a side lacks. */
  readonly fighterName?: (fighter: number) => string;
  /** A player's buttons as the game takes them: each of the pad's eight an entry of its table of `keyChoices`; its own setup as it powers on, for a player who sent none the game can take. */
  readonly keyChoices: number;
  readonly defaultKeys: readonly number[];
  /** The match's options, as the host decides them for a match played as version `as`. */
  options(as: string): Readonly<Record<string, unknown>>;
  /**
   * The match begun from its start, this side in `seat`, played as version `as`, with the board's
   * fighters' own accessories where `ownBoard` (both sides draw the same with them) and the disc's
   * otherwise: the game reset to it, and how a field of it is stepped and saved.
   */
  begin(start: Start, seat: 0 | 1, as: string, ownBoard: boolean): { readonly step: (words: readonly [number, number], field: number) => void; readonly snapshotter: Snapshotter<unknown> };
  /** The match is over, for `why` (the game goes back to where it was; 'over' its fight ended, its result asked about). */
  end(why: string): void;
  /** A match's result left without a rematch: back to waiting. */
  waiting?(): void;
}

/** This player as the other is told it: read at each pairing, so the page's settings hold as they change. */
export interface Player {
  readonly name: string;
  readonly delay: number;
  readonly keys: readonly number[];
  readonly fighter: Fighter;
  /** The id this player's game keeps (hex digits), by which a server counts their streak of wins; none, no streak counted. */
  readonly id?: string;
  /** The side this player asks to see their fighter on (0 the left, 1 the right). */
  readonly side?: number;
  /** The packs this side draws with the arcade board's models and their accessories' fingerprint (`Hello`'s `board`; '0' none). */
  readonly board?: string;
}

export interface OnlineOptions<S> {
  /** The server's address (or its addresses, tried in turn until one opens), or null where none is set. */
  readonly url: () => string | readonly string[] | null;
  readonly game: OnlineGame<S>;
  readonly player: () => Player;
  /** The socket to the server (a browser's WebSocket by default). */
  readonly open?: (url: string) => SocketLike;
  /** A peer connection for the direct path, from the ICE servers the server names (the browser's by default; null: always through the server). */
  readonly peerConnection?: ((ice: readonly unknown[]) => PeerLike | null) | null;
  /** The wall clock, for the round trips and the direct connection's timeout. */
  readonly now?: () => number;
  /** Milliseconds each of the other side's packets is held before it is read, to try a match over a slower link. */
  readonly lagMs?: number;
}

/**
 * The version two games are paired by online: the oldest release whose matches this one plays
 * exactly as, its simulation, its match's setup and the words between the two games alike. A
 * release that changes none of them (one that only draws or sounds otherwise) keeps it, so its
 * players and those of every release back to that one play each other; one that changes any of
 * them sets it to its own version.
 */
export const PLAYS_AS = '0.7.8';

/**
 * The older versions this release also plays a match as, each with the fields of the state its own
 * matches have and that version's has not: a match as one is played without what those fields
 * hold (the remake's walls; the moves into the screen of a player who sees the fight from the
 * other side going by that view), and those fields (all at rest) left out of its fingerprint. A
 * version whose matches differ from this one's in nothing but the code, as 0.7.6's and 0.7.7's,
 * leaves none out.
 */
export const ALSO_PLAYS: Readonly<Record<string, readonly string[]>> = { '0.7.7': [], '0.7.6': [], '0.7.0': ['depthTurned'], '0.6.5': ['wallHit', 'carried', 'splatted', 'splatHits', 'walls', 'depthTurned'] };

/**
 * Whether a match keeps the arcade board's fighters' own accessories: only where both sides draw
 * the same packs with the board's models, so both fights swing the same; otherwise both swing the
 * disc's, which every player has. A side that says nothing of it (before 0.7.8) is taken to draw
 * the disc's.
 */
export const ownBoard = (ours: string | undefined, theirs: string | undefined): boolean => ours !== undefined && ours !== '0' && ours === theirs;

/** Whether a match played as version `as` has `field` of the state: every one but those that version lacks. */
export function playedWith(as: string, field: string): boolean {
  return !(ALSO_PLAYS[as] ?? []).includes(field);
}

/** Fields of this side's own presses sent to the server at a time, for those watching the fight. */
const WORDS_EVERY = 15;
/** Frames between round trips measured: twice a second. */
const PING_EVERY = 30;
/** Round trips the shown one is the mean of. */
const PING_WINDOW = 8;
/** Frames between the heartbeats a side sends while it cannot play on (it is loading), and between its words that it is ready for the fight while it holds for the other. */
const WAIT_EVERY = 15;
/** Milliseconds at most between those heartbeats, however slowly a loading side's frames come. */
const WAIT_MS = 250;
/**
 * Frames a side holding for the other, on the fight's last loading field or gone into the fight
 * before the other plays it (`meeting`), may hear nothing from it before the other is taken for
 * gone: thirty seconds, as a device busy loading the fight or drawing its first pictures says
 * nothing meanwhile, and one that has gone is told by the server at once.
 */
const HOLD_SILENCE = 1800;
/** Frames a side holds for the other's word that it is ready while the other says nothing of loading: three seconds, past which the other went into the fight without saying so. */
const READY_WAIT = 180;
/** Fields of the fight past its first, and the input delay's, the other side's words must be in for before this side shows the fight: they are sent only as it plays them. */
const MEET = 10;
/** Frames between asking the server for its room list, while it is shown. */
const ROOMS_EVERY = 180;
/** Milliseconds the host waits, both hellos in, before it starts the match: the opponent found shown a moment on both sides. */
const GREETING_HOLD_MS = 1500;
/** Milliseconds a match's result waits for both players to ask for a rematch. */
export const REMATCH_MS = 30_000;
/** A match over on this side: its last words sent again every few frames for its first milliseconds. */
const TAIL_EVERY = 6;
const TAIL_MS = 3000;
/** Fields of a wait over the direct channel after which the words go through the server as well. */
const RELAY_TOO_AFTER = 30;

/** Each reason a side is refused or a match ends, as a player is shown it. */
const WHY: Readonly<Record<string, string>> = {
  'no room': 'NO ROOM WITH THAT CODE',
  'no fight': 'THE FIGHT IS OVER',
  full: 'THAT ROOM IS FULL',
  password: 'WRONG PASSWORD',
  'different game': 'THEIR GAME DIFFERS',
  'own room': 'THAT IS YOUR OWN ROOM',
  busy: 'THE SERVER IS FULL',
  protocol: 'THE SERVER SPEAKS ANOTHER VERSION',
  game: 'NOT A TEKKEN 3 SERVER',
  left: 'THE OTHER PLAYER LEFT',
  gone: 'THE OTHER PLAYER WAS DISCONNECTED',
  closed: 'THE SERVER CLOSED THE CONNECTION',
  unreachable: 'THE SERVER CANNOT BE REACHED',
  insecure: 'THIS PAGE NEEDS A WSS:// SERVER',
  'no server': 'SET THE SERVER FIRST',
  'no answer': 'THE OFFER WAS NOT ANSWERED',
  'no rematch': 'NO REMATCH',
  over: 'MATCH OVER',
  declined: 'THE OTHER PLAYER SAID NO',
  disconnected: 'THE CONNECTION WAS LOST',
  desynced: 'THE GAMES DIFFERED',
  'cannot watch': 'CANNOT WATCH THIS FIGHT',
  quit: 'MATCH OVER',
};

export const whyLine = (why: string): string => WHY[why] ?? why.toUpperCase();

/** A roster as a build's word: the fighters whose data a side has, a bit each, in hex. */
export const rosterWord = (fighters: Iterable<number>): string => {
  let bits = 0n;
  for (const fighter of fighters) bits |= 1n << BigInt(fighter);
  return bits.toString(16);
};

const rosterOf = (word: string | undefined): bigint => {
  try {
    return BigInt(`0x${word ?? '0'}`);
  } catch {
    return 0n;
  }
};

/** A player as another is matched against them: their game's version (and the versions it plays a match as, its own first, where it says them), the fighters whose data they have (`rosterWord`), and the fighter they chose (its roster id; -1 none yet). */
export interface Side {
  readonly version: string;
  readonly plays?: readonly string[];
  readonly roster: string;
  readonly fighter: number;
}

/** Whether a side has this fighter's data (any, for no fighter). */
const hasFighter = (side: Side, fighter: number): boolean => fighter < 0 || ((rosterOf(side.roster) >> BigInt(fighter)) & 1n) === 1n;

/**
 * Why two players cannot play each other, as a player is shown it, or the empty string where they
 * can: a version both play a match as, and each one's fighter one whose data the other has. Their rosters may
 * differ otherwise, and their games' data too: should it make the two games play differently, the
 * match's own comparison ends it.
 */
export function cannotPlay(ours: Side, theirs: Side, name: (fighter: number) => string = (fighter) => `FIGHTER ${fighter}`): string {
  const shared = theirs.plays ?? [theirs.version];
  if (!(ours.plays ?? [ours.version]).some((version) => shared.includes(version))) return `THE OTHER PLAYER HAS VERSION ${theirs.version || '?'}`;
  if (!hasFighter(theirs, ours.fighter)) return `THE OTHER PLAYER LACKS ${name(ours.fighter)}`;
  if (!hasFighter(ours, theirs.fighter)) return `YOU LACK ${name(theirs.fighter)}`;
  return '';
}

/** A side as another sent it (its fighter a number, its roster a word), or null. */
function sideOf(value: unknown): Side | null {
  if (value === null || typeof value !== 'object') return null;
  const { version, plays, roster, fighter } = value as Record<string, unknown>;
  return { version: String(version ?? ''), ...(Array.isArray(plays) ? { plays: plays.map(String) } : {}), roster: typeof roster === 'string' ? roster : '0', fighter: Number.isInteger(fighter) ? (fighter as number) : -1 };
}

export class Online<S> {
  state: OnlineState = 'off';
  /** The server's name and line, once welcomed. */
  server = '';
  motd = '';
  /** The room code hosted or joined. */
  code = '';
  /** The rooms the server last listed. */
  rooms: readonly ListedRoom[] = [];
  /** The fights under way the server lists, as last asked for; the one watched, while one is. */
  fights: readonly ListedFight[] = [];
  tape: Tape | null = null;
  /** Whether the server keeps fights for watching (it says so at its welcome), and this side's own presses of the match under way, by field, and how many of them the server has been sent. */
  private serverTapes = false;
  private taped: { readonly match: number; readonly words: number[]; sent: number } | null = null;
  /** The other player's name, once offered or paired. */
  opponent = '';
  /** The players on the server and those in its quick match, as it last said (-1 not said). */
  players = -1;
  queued = -1;
  /** This player's streak of matches won without a loss, and the other's while paired, as the server last said (-1 where it counts none). */
  wins = -1;
  opponentWins = -1;
  /** The queue's offer: when it runs out (the wall clock's milliseconds), and this player's answer (null none yet). */
  offerUntil = 0;
  offerSeconds = 0;
  answered: boolean | null = null;
  /** A match's result: when its question runs out, and this player's answer (true a rematch, false the waiting room). */
  resultUntil = 0;
  rematchMine: boolean | null = null;
  /** This side's seat once paired: 0 the host's (the first pad), 1 the guest's. */
  seat: 0 | 1 = 0;
  /** The version the pairing's matches are played as: the server's word as they were paired (where it says one), the game's own otherwise. */
  playsAs = '';
  /** Whether this player may be offered an opponent now (`setAvailable`), and whether the server waits for its word on it (it says so at its welcome). */
  private available = true;
  private serverWaits = false;
  /** Why the last match or attempt ended, as a line (the empty string while none has). */
  ended = '';
  /** The round trip to the server, or through it to the other player while paired, in milliseconds. */
  roundTripMs = 0;
  /** Whether the other side is waiting for this one (it said so lately), or loading. */
  theyWait = false;
  /** Whether this side held on the fight's last loading field this frame, ready, for the other to be. */
  holding = false;
  /**
   * The fight's first field, this side gone into it, while the other has not played into it too
   * (`meeting`): null once it has, or before a fight is gone into.
   */
  private inFrom: number | null = null;
  /** The frame this side went into the fight on. */
  private inAt = 0;
  session: MatchSession<unknown> | null = null;

  private readonly options: OnlineOptions<S>;
  private relay: RelayClient | null = null;
  private ice: readonly unknown[] = [];
  private theirs: Hello | null = null;
  private wire: SwitchableSocket | null = null;
  private transport: Transport | null = null;
  private peering: Peering | null = null;
  private frames = 0;
  private pinged = 0;
  private readonly trips: number[] = [];
  private theyWaitAt = -1;
  /** The match the other side said it is ready to fight, and the match this side last said so of. */
  private theyAreReady = -1;
  private saidReady = -1;
  /** The match this side last held for the other in, and the frame it began to. */
  private heldFor = -1;
  private heldSince = 0;
  /** When this side last said it is loading. */
  private waitSaidAt = -Infinity;
  /** The frame the other side was last heard from. */
  private heardAt = 0;
  private listing = false;
  private listingFights = false;
  /** The host's start, decided and waiting for its moment (`GREETING_HOLD_MS`); the last match's start, a rematch's ground; the other player's rematch answer. */
  private starting: { readonly start: Start; readonly at: number } | null = null;
  private lastStart: Start | null = null;
  private rematchTheirs: boolean | null = null;
  /** The match just over on this side, its last words sent again a while for the other side, which may be fields behind. */
  private tail: MatchSession<unknown> | null = null;

  constructor(options: OnlineOptions<S>) {
    this.options = options;
    this.playsAs = options.game.version;
  }

  /** The versions this game plays a match as: its own, then the older ones it also plays. */
  private get versions(): readonly string[] {
    return [this.options.game.version, ...(this.options.game.plays ?? [])];
  }

  /** This player as another is matched against them: the versions it plays a match as, the fighters whose data this side has, the fighter chosen. */
  private get side(): Side {
    const fighter = this.options.player().fighter?.roster;
    return { version: this.options.game.version, plays: this.versions, roster: rosterWord(this.options.game.roster), fighter: Number.isInteger(fighter) ? fighter! : -1 };
  }

  /** Why this player cannot play the side another sent (`cannotPlay`), or the empty string (also where it sent none); `paired`, against the version the pairing plays as alone. */
  private whyNot(theirs: unknown, paired = false): string {
    const side = sideOf(theirs);
    const ours = paired ? { ...this.side, version: this.playsAs, plays: [this.playsAs] } : this.side;
    return side === null ? '' : cannotPlay(ours, side, this.options.game.fighterName);
  }

  private get now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** The connection to the server, made if there is none. */
  connect(): boolean {
    if (this.relay !== null && !this.relay.closedNow) return true;
    const given = this.options.url();
    const urls = given === null ? [] : typeof given === 'string' ? [given] : [...given];
    if (urls.length === 0) {
      this.ended = whyLine('no server');
      this.state = 'off';
      return false;
    }
    this.state = 'connecting';
    this.ended = '';
    return this.reach(urls, 0, [], false);
  }

  /**
   * The server reached by the first of `urls` from `at` that opens: each tried in turn as the one
   * before it fails to (a bare address tried secure, then plain), what was asked of the one that
   * failed (`carried`) asked again of the next. `refused`, whether a way was refused as insecure.
   */
  private reach(urls: readonly string[], at: number, carried: readonly string[], refused: boolean): boolean {
    for (let i = at; i < urls.length; i += 1) {
      let relay: RelayClient;
      try {
        relay = new RelayClient(urls[i]!, this.options.open, carried);
      } catch (error) {
        /* A secure page may not open a plain `ws://` server (the browser says so as it is asked). */
        refused ||= (error as { name?: unknown }).name === 'SecurityError';
        continue;
      }
      this.relay = relay;
      let welcomed = false;
      relay.onEvent = (event) => {
        if (event.ev === 'welcome') welcomed = true;
        this.event(event);
      };
      relay.onClosed = () => {
        if (this.relay !== relay) return;
        this.relay = null;
        /* Closed before the server welcomed this player (whatever was asked meanwhile): the next way to it, if one is left. */
        if (!welcomed && i + 1 < urls.length && this.reach(urls, i + 1, relay.unsent(), refused)) return;
        this.stop(welcomed ? 'closed' : 'unreachable');
        this.state = 'off';
      };
      const { name, id } = this.options.player();
      if (!carried.some((text) => text.includes('"do":"hello"'))) relay.say({ do: 'hello', game: GAME, protocol: PROTOCOL, name, build: this.options.game.version, plays: this.versions, roster: rosterWord(this.options.game.roster), ...(id === undefined ? {} : { id }) });
      return true;
    }
    this.ended = whyLine(refused ? 'insecure' : 'unreachable');
    this.state = 'off';
    return false;
  }

  /** The quick match's queue: paired with the next player of the same game. */
  quickMatch(): void {
    this.lobbyCommand('queued', { do: 'queue', fighter: this.side.fighter, available: this.available });
  }

  /** The fights under way (`fights`, as the server answers), asked for now and every few seconds while `on`. */
  listFights(on = true): void {
    this.listingFights = on;
    if (on && this.connect()) this.relay!.say({ do: 'fights' });
  }

  /** Watching the fight in the room `code`: out of the queue or a room, its start and its presses given as they come (`tape`). */
  watch(code: string): void {
    this.tape = null;
    this.listingFights = false;
    this.lobbyCommand('watching', { do: 'watch', code });
  }

  /** No longer watching. */
  unwatch(): void {
    if (this.state !== 'watching') return;
    this.relay?.say({ do: 'unwatch' });
    this.tape = null;
    this.state = 'lobby';
  }

  /**
   * Whether this player may be offered an opponent now (in the waiting room's fight, playing, the
   * page in sight): told the server as it changes, where the server waits for the word (an older
   * server offers whoever waits).
   */
  setAvailable(available: boolean): void {
    if (available === this.available) return;
    this.available = available;
    if (this.serverWaits && (this.state === 'queued' || this.state === 'hosting' || this.state === 'joining')) this.relay?.say({ do: 'available', available });
  }

  /** A room of this player's own, its code to give the other player; listed in the server's room list or not. */
  host(listed: boolean, pass = ''): void {
    /* Its code is the server's to give: none until then. */
    this.code = '';
    this.lobbyCommand('hosting', { do: 'host', listed, pass, fighter: this.side.fighter, available: this.available });
  }

  /** The room with this code. */
  join(code: string, pass = ''): void {
    this.code = code;
    this.lobbyCommand('joining', { do: 'join', code, pass, fighter: this.side.fighter, available: this.available });
  }

  /** The server's room list, asked for now and every few seconds while `listing`. */
  listRooms(on: boolean): void {
    this.listing = on;
    if (on) this.relay?.say({ do: 'rooms' });
  }

  /**
   * The match over by its fight's end, `winner` the seat that won it (-1 a draw): the game back to
   * the waiting room's fight under the result, both asked for a rematch (`rematch`), the pairing kept
   * meanwhile; the result told to a server that counts streaks of wins.
   */
  matchOver(winner = -1): void {
    if (this.state !== 'playing') return;
    if (0 <= this.wins && this.lastStart !== null) this.relay?.say({ do: 'result', match: this.lastStart.match, winner });
    this.sendTaped(true);
    this.taped = null;
    this.tail = this.session;
    this.session = null;
    this.state = 'result';
    this.resultUntil = this.now + REMATCH_MS;
    this.rematchMine = null;
    this.rematchTheirs = null;
    this.options.game.end('over');
  }

  /** Seconds a match's result has left to be answered. */
  get resultLeft(): number {
    return this.state === 'result' ? Math.max(0, (this.resultUntil - this.now) / 1000) : 0;
  }

  /** This player's answer to the result: a rematch (once the other asks too), or the waiting room (for both). */
  rematch(yes: boolean): void {
    if (this.state !== 'result' || this.rematchMine !== null) return;
    this.rematchMine = yes;
    this.relay?.toPeer({ k: 'rematch', yes });
    if (yes) this.maybeRematch();
    else this.afterResult('no rematch');
  }

  /** Both asked for a rematch: the host starts the same two fighters again, on a stage drawn anew. */
  private maybeRematch(): void {
    if (this.state !== 'result' || this.rematchMine !== true || this.rematchTheirs !== true || this.seat !== 0 || this.lastStart === null) return;
    const start: Start = { ...this.lastStart, options: this.options.game.options(this.playsAs), match: this.lastStart.match + 1 };
    this.relay?.toPeer(start);
    this.begin(start);
  }

  /** The result left without a rematch: the room left (a quick match's two kept apart a while), back to waiting. */
  private afterResult(why: string): void {
    this.relay?.say({ do: 'leave', apart: why === 'no rematch' });
    this.stop(why);
    this.options.game.waiting?.();
  }

  /** This player's answer to the queue's offer: yes plays them (once they say yes too), no looks for another. */
  answer(yes: boolean): void {
    if (this.state !== 'offered' || this.answered !== null) return;
    this.answered = yes;
    this.relay?.say({ do: 'answer', yes });
  }

  /** Seconds the queue's offer has left. */
  get offerLeft(): number {
    return this.state === 'offered' ? Math.max(0, (this.offerUntil - this.now) / 1000) : 0;
  }

  /** Out of the queue, the room or the match, back to the lobby. */
  cancel(): void {
    if (this.state === 'playing') this.finish('quit', 'left');
    if (this.relay !== null && this.state !== 'off' && this.state !== 'connecting') {
      this.relay.say({ do: 'leave' });
      this.state = 'lobby';
    }
    this.code = '';
  }

  /** Off the server altogether. */
  disconnect(): void {
    this.cancel();
    const relay = this.relay;
    this.relay = null;
    relay?.close();
    this.state = 'off';
  }

  /**
   * One frame of the page: the server asked what it should be asked, and while a match is played
   * this player's word given to it. `ready` false holds this side (it is loading the fight): the
   * other is told so, and waits. `atStart` where the field to play is the fight's last loading one:
   * there a side ready holds for the other to be. Whether a field was played.
   */
  frame(word: number, ready = true, atStart = false): boolean {
    this.frames += 1;
    this.peering?.tick();
    if (this.tail !== null && this.frames % TAIL_EVERY === 0) {
      if (this.state === 'result' && this.now < this.resultUntil - REMATCH_MS + TAIL_MS) this.tail.sendAgain();
      else this.tail = null;
    }
    if (this.state === 'result' && this.resultUntil <= this.now) {
      this.relay?.toPeer({ k: 'rematch', yes: false });
      this.afterResult('no rematch');
    }
    const starting = this.starting;
    if (starting !== null && this.state === 'greeting' && starting.at <= this.now) {
      this.starting = null;
      this.relay?.toPeer(starting.start);
      this.begin(starting.start);
    }
    if (this.theyWait && this.frames - this.theyWaitAt > WAIT_EVERY * 3) this.theyWait = false;
    if (this.state === 'lobby' && this.listing && this.frames % ROOMS_EVERY === 0) this.relay?.say({ do: 'rooms' });
    if (this.state === 'lobby' && this.listingFights && this.frames % ROOMS_EVERY === 0) this.relay?.say({ do: 'fights' });
    if (this.frames % PING_EVERY === 0) this.ping();
    const session = this.session;
    this.holding = false;
    if (session === null) return false;
    if (!ready) {
      if (this.frames % WAIT_EVERY === 0 || this.now - this.waitSaidAt >= WAIT_MS) {
        this.relay?.toPeer({ k: 'wait' });
        this.waitSaidAt = this.now;
      }
      return false;
    }
    /*
     * The fight's last loading field, this side ready: it says so, and with another that starts each
     * fight together holds there until that one has said so too, both then going into the fight on
     * the same field rather than one stopping in it for the other. One that always says so
     * (`saysReady`) is held for while it is heard from; an older one that has said nothing of
     * loading for `READY_WAIT` went in without saying it was ready (as a 0.7.0 game that played a
     * match before the pairing does): this side goes in after it.
     */
    const match = this.lastStart?.match ?? 0;
    if (atStart) {
      if (this.saidReady !== match || this.frames % WAIT_EVERY === 0) {
        this.relay?.toPeer({ k: 'ready', match });
        this.saidReady = match;
      }
      if (this.theirs?.together === true && this.theyAreReady !== match) {
        if (this.heldFor !== match) {
          this.heldFor = match;
          this.heldSince = this.frames;
        }
        if (this.frames - this.heardAt > HOLD_SILENCE) {
          this.finish('disconnected', 'left');
          return false;
        }
        if (this.theyWait || this.theirs.saysReady === true || this.frames - this.heldSince < READY_WAIT) {
          this.holding = true;
          return false;
        }
      }
    }
    /* Gone into the fight, the other not yet playing it: its silence is not a lost connection until `HOLD_SILENCE`. */
    if (this.inFrom !== null && this.frames - this.inAt < HOLD_SILENCE) session.heard();
    const played = session.advance(word);
    if (atStart && played) {
      this.inFrom = session.tick;
      this.inAt = this.frames;
    }
    if (this.inFrom !== null && session.final >= this.inFrom + session.inputDelay + MEET) this.inFrom = null;
    this.sendTaped(false);
    const state: SessionState = session.state;
    /* A wait this long over the direct channel: it may carry nothing any more, while the server's pings still come. */
    if (state === 'stalled' && session.stalling > RELAY_TOO_AFTER && this.wire?.direct === true) {
      this.wire.relayToo();
      console.warn('[tekken3 online] the direct connection carried nothing for half a second: the words go through the server as well');
    }
    if (state === 'disconnected' || state === 'desynced' || state === 'halted') {
      const why = state === 'desynced' ? `desynced` : state === 'halted' ? session.reason : 'disconnected';
      if (state === 'desynced' && session.desync !== null) console.warn(`[tekken3 online] the games differed at field ${session.desync.tick} (${session.desync.ours} here, ${session.desync.theirs} there)`);
      this.finish(why, why === 'desynced' ? 'desynced' : 'left', state === 'desynced' ? session.desync?.tick : undefined);
    }
    return played;
  }

  /**
   * Whether this side, gone into the fight, holds its picture for the other to have played into it
   * too: a device slow to draw its fight's first pictures plays nothing meanwhile, and the fight
   * here would stand still waiting for its words; both show it once both play on.
   */
  get meeting(): boolean {
    return this.inFrom !== null && this.session !== null;
  }

  /** The match's connection as a player is shown it, while one is played. */
  get quality(): ConnectionQuality | null {
    return this.session?.quality ?? null;
  }

  /** Whether the words go straight between the two. */
  get direct(): boolean {
    return this.wire?.direct === true;
  }

  /** The game reached its end on this side (left the mode): the match over, both back to the lobby. */
  leaveMatch(): void {
    if (this.state === 'playing') this.finish('quit', 'quit');
  }

  /** The server's counts, where it gives them (an older server gives none). */
  private countsFrom(event: { readonly players?: number; readonly queued?: number }): void {
    if (Number.isInteger(event.players)) this.players = event.players!;
    if (Number.isInteger(event.queued)) this.queued = event.queued!;
  }

  private lobbyCommand(state: OnlineState, command: { readonly do: string } & Record<string, unknown>): void {
    if (this.state === 'playing' || !this.connect()) return;
    this.relay!.say({ do: 'leave' });
    this.relay!.say(command);
    this.state = state;
    this.ended = '';
  }

  private event(event: ServerEvent): void {
    switch (event.ev) {
      case 'welcome':
        this.server = event.name;
        this.motd = event.motd;
        this.countsFrom(event);
        this.wins = Number.isInteger(event.wins) ? event.wins! : -1;
        this.ice = Array.isArray(event.ice) ? event.ice : [];
        this.serverWaits = event.availability === true;
        this.serverTapes = event.spectate === true;
        if (this.state === 'connecting') this.state = 'lobby';
        return;
      case 'hosting':
        this.code = event.code;
        this.state = 'hosting';
        this.answered = null;
        return;
      case 'queued':
        this.state = 'queued';
        this.answered = null;
        return;
      case 'offer':
        this.state = 'offered';
        this.opponent = event.peer.name;
        this.offerUntil = this.now + event.seconds * 1000;
        this.offerSeconds = event.seconds;
        this.answered = null;
        return;
      case 'idle':
        this.state = 'lobby';
        this.answered = null;
        this.ended = whyLine(event.why);
        return;
      case 'rooms':
        this.rooms = event.rooms;
        return;
      case 'fights': {
        /* A fight whose two swing the board's fighters is shown only by a game that draws the same with them. */
        const board = this.options.player().board;
        this.fights = Array.isArray(event.fights) ? event.fights.map((fight) => (fight.board === undefined || ownBoard(board, fight.board) ? fight : { ...fight, watchable: false })) : [];
        return;
      }
      case 'tape': {
        if (this.state !== 'watching' || event.start === null || typeof event.start !== 'object') return;
        const board = (event.start as Start).board;
        if (board !== undefined && !ownBoard(this.options.player().board, board)) {
          this.unwatch();
          this.ended = whyLine('cannot watch');
          return;
        }
        const [first = '', second = ''] = event.names;
        const [won = 0, theirs = 0] = event.wins;
        this.tape = { code: event.code, match: event.match, start: event.start as Start, as: event.as, names: [first, second], wins: [won, theirs], words: [[...(event.words[0] ?? [])], [...(event.words[1] ?? [])]] };
        return;
      }
      case 'words': {
        const own = this.tape?.words[event.seat];
        if (own !== undefined && event.from === own.length) own.push(...event.words);
        return;
      }
      case 'watched':
        if (this.state !== 'watching') return;
        this.tape = null;
        this.state = 'lobby';
        this.ended = whyLine('no fight');
        return;
      case 'paired':
        this.opponentWins = Number.isInteger(event.peer.wins) ? event.peer.wins! : -1;
        this.paired(event.seat, event.code, event.peer.name, event.as);
        return;
      case 'wins':
        if (!Number.isInteger(event.wins)) return;
        this.wins = event.wins;
        this.opponentWins = Number.isInteger(event.peer) ? event.peer! : -1;
        return;
      case 'peer':
        this.peer(event.body);
        return;
      case 'left':
        if (this.state === 'result') this.afterResult(event.why === 'gone' ? 'gone' : 'left');
        else if (this.state === 'greeting' || this.state === 'playing') this.stop(event.why === 'gone' ? 'gone' : 'left');
        return;
      case 'refused':
        this.ended = (event.why === 'different game' && this.whyNot(event.theirs)) || whyLine(event.why);
        this.state = this.relay === null ? 'off' : 'lobby';
        return;
      case 'pong':
        if (this.session === null && event.t === this.pinged) this.trip(this.now - event.t);
        this.countsFrom(event);
        return;
      case 'error':
        console.warn(`[tekken3 online] the server: ${event.why}`);
        return;
    }
  }

  private paired(seat: 0 | 1, code: string, opponent: string, as: string | undefined): void {
    this.seat = seat;
    this.playsAs = as !== undefined && this.versions.includes(as) ? as : this.options.game.version;
    this.code = code;
    this.opponent = opponent;
    this.state = 'greeting';
    this.theirs = null;
    this.trips.length = 0;
    /* A new pairing's matches are numbered from 1 again: nothing either side said of being ready, or loading, in the last one holds. */
    this.theyAreReady = -1;
    this.saidReady = -1;
    this.heldFor = -1;
    this.theyWait = false;
    this.theyWaitAt = -1;
    /* The transport made now: the host's first words may come before its start is read here. */
    this.wire = switchableSocket(this.relay!.forInputs);
    const transport = new WebSocketTransport({ socket: this.wire.socket, self: seat });
    this.transport = (this.options.lagMs ?? 0) > 0 ? new LateTransport(transport, this.options.lagMs!, () => this.now) : transport;
    const { name, delay, keys, fighter, side, board } = this.options.player();
    const hello: Hello = { k: 'hello', version: this.playsAs, roster: rosterWord(this.options.game.roster), name, delay, keys, fighter, together: true, draws: true, saysReady: true, ...(side === undefined ? {} : { side: side === 1 ? 1 : 0 }), ...(board === undefined ? {} : { board }) };
    this.relay!.toPeer(hello);
  }

  private peer(body: unknown): void {
    if (body === null || typeof body !== 'object') return;
    const message = body as { readonly k?: unknown };
    this.heardAt = this.frames;
    switch (message.k) {
      case 'hello':
        return this.hello(body as Hello);
      case 'start':
        if (this.seat === 1 && (this.state === 'greeting' || (this.state === 'result' && this.rematchMine === true))) this.begin(body as Start);
        return;
      case 'rematch': {
        if (this.state !== 'result') return;
        this.rematchTheirs = (body as { yes?: unknown }).yes === true;
        if (this.rematchTheirs) this.maybeRematch();
        else this.afterResult('no rematch');
        return;
      }
      case 'refuse': {
        const { why, side } = body as { why?: unknown; side?: unknown };
        this.stop(String(why ?? 'different game'));
        this.ended = this.whyNot(side) || this.ended;
        return;
      }
      case 'signal': {
        const { kind, text } = body as { kind?: unknown; text?: unknown };
        if ((kind === 'offer' || kind === 'answer' || kind === 'candidate') && typeof text === 'string') void this.signal(kind, text);
        return;
      }
      /* A ping or a pong says the other's page is there, not that its game plays: a match stalled on it ends all the same. */
      case 'ping':
        this.relay?.toPeer({ k: 'pong', t: (body as { t?: unknown }).t, ahead: this.session?.ahead ?? 0 });
        this.session?.theirLead(Number((body as { ahead?: unknown }).ahead));
        return;
      case 'pong': {
        const t = (body as { t?: unknown }).t;
        if (t === this.pinged) this.trip(this.now - this.pinged);
        this.session?.theirLead(Number((body as { ahead?: unknown }).ahead));
        return;
      }
      case 'wait':
        this.theyWait = true;
        this.theyWaitAt = this.frames;
        this.session?.heard();
        return;
      case 'ready':
        this.theyAreReady = Number((body as { match?: unknown }).match);
        this.theyWait = false;
        this.session?.heard();
        return;
      case 'bye': {
        const why = String((body as { why?: unknown }).why ?? 'left');
        if (this.state === 'result') this.afterResult(why);
        else this.stop(why);
        return;
      }
    }
  }

  /** Their hello: a different game refused; the host, with both hellos, starts the match. */
  private hello(theirs: Hello): void {
    if (this.state !== 'greeting') return;
    this.theirs = theirs;
    const why = this.whyNot({ version: theirs.version, roster: theirs.roster, fighter: theirs.fighter?.roster }, true);
    if (why !== '') {
      this.relay?.toPeer({ k: 'refuse', why: 'different game', side: this.side });
      this.stop('different game');
      this.ended = why;
      return;
    }
    if (this.seat !== 0) return;
    const ours = this.options.player();
    const delay = Math.max(ours.delay, Number.isFinite(theirs.delay) ? theirs.delay : DEFAULT_INPUT_DELAY);
    /* Each player's own buttons, as the game takes them; the game's setup as it powers on for one it cannot. */
    const { keyChoices, defaultKeys } = this.options.game;
    const keys = (k: readonly number[]): readonly number[] => (Array.isArray(k) && k.length === 8 && k.every((n) => Number.isInteger(n) && 0 <= n && n < keyChoices) ? [...k] : [...defaultKeys]);
    const fighter = (f: Fighter | undefined): Fighter => ({ roster: Number.isInteger(f?.roster) ? f!.roster : 0, costume: Number.isInteger(f?.costume) ? f!.costume & 3 : 0 });
    /* A player whose seat is not the side they asked for sees the fight from the other side, where both said which they asked for. */
    const turned = ours.side === undefined || (theirs.side !== 0 && theirs.side !== 1) ? 0 : (ours.side === 1 ? 1 : 0) | (theirs.side === 1 ? 0 : 2);
    const board = ownBoard(ours.board, theirs.board) ? { board: ours.board! } : {};
    const start: Start = { k: 'start', options: this.options.game.options(this.playsAs), delay, keys: [keys(ours.keys), keys(theirs.keys)], fighters: [fighter(ours.fighter), fighter(theirs.fighter)], match: 1, ...(theirs.draws === true ? { draws: 1 } : {}), ...(turned !== 0 ? { turned } : {}), ...board };
    this.starting = { start, at: this.now + GREETING_HOLD_MS };
  }

  private begin(start: Start): void {
    this.lastStart = start;
    this.tail = null;
    this.inFrom = null;
    this.heardAt = this.frames;
    /* What the last match left in the transport is no word of this one's. */
    this.transport?.drain(() => {});
    const { step: played, snapshotter } = this.options.game.begin(start, this.seat, this.playsAs, ownBoard(this.options.player().board, this.theirs?.board));
    /* This side's own presses kept, each field's the first time it is played, for those watching (its own press never guessed); the host gives the match's start. */
    const match = Number.isInteger(start.match) ? start.match : 0;
    const taped = { match, words: [] as number[], sent: 0 };
    this.taped = taped;
    if (this.serverTapes && this.seat === 0) this.relay?.say({ do: 'tape', match, start, as: this.playsAs });
    const step = (words: readonly [number, number], field: number): void => {
      if (field === taped.words.length) taped.words.push(words[this.seat]);
      played(words, field);
    };
    this.session = new MatchSession({ step, snapshotter, transport: this.transport!, self: this.seat, inputDelay: [start.delay, start.delay], match: Number.isInteger(start.match) ? start.match : 0 });
    this.state = 'playing';
    this.ended = '';
    /* A rematch keeps the way its words already go. */
    if (this.seat === 0 && this.peering === null) void this.startPeering();
  }

  private makePeering(): Peering | null {
    const make = this.options.peerConnection === undefined ? browserPeerConnection : this.options.peerConnection;
    if (make === null || this.wire === null || this.ice.length === 0) return null;
    const peer = make(this.ice);
    if (peer === null) return null;
    const wire = this.wire;
    return new Peering({
      peer,
      signal: (kind, text) => this.relay?.toPeer({ k: 'signal', kind, text }),
      onDirect: (channel: ChannelLike) => {
        wire.switchTo(channel);
        this.session?.wentDirect();
      },
      now: () => this.now,
    });
  }

  private async startPeering(): Promise<void> {
    this.peering ??= this.makePeering();
    await this.peering?.offer().catch(() => this.peering?.fallBack('the offer failed'));
  }

  private async signal(kind: SignalKind, text: string): Promise<void> {
    if (this.session === null) return;
    this.peering ??= this.makePeering();
    await this.peering?.accept(kind, text).catch(() => this.peering?.fallBack('the negotiation failed'));
  }

  private ping(): void {
    if (this.relay === null || this.state === 'off' || this.state === 'connecting') return;
    this.pinged = this.now;
    if (this.state === 'playing' || this.state === 'greeting') this.relay.toPeer({ k: 'ping', t: this.pinged, ahead: this.session?.ahead ?? 0 });
    else this.relay.say({ do: 'ping', t: this.pinged });
  }

  private trip(ms: number): void {
    if (!(0 <= ms && ms < 10_000)) return;
    this.trips.push(ms);
    while (this.trips.length > PING_WINDOW) this.trips.shift();
    this.roundTripMs = this.trips.reduce((sum, one) => sum + one, 0) / this.trips.length;
    this.session?.measured(this.roundTripMs);
  }

  /** The match over on this side for `why`, the other side told `told` (and `at`, the field where the games differed, for the server's log). */
  private finish(why: string, told: string, at?: number): void {
    this.relay?.toPeer({ k: 'bye', why: told, ...(at === undefined ? {} : { at }) });
    this.relay?.say({ do: 'leave' });
    this.stop(why);
  }

  /** Whatever was paired or played ended for `why`; back in the lobby. */
  /** This side's presses the server has not had yet, a batch at a time (`all`, every one left, as the match ends), where it keeps fights. */
  private sendTaped(all: boolean): void {
    const taped = this.taped;
    if (taped === null || !this.serverTapes) return;
    const left = taped.words.length - taped.sent;
    if (left === 0 || (!all && left < WORDS_EVERY)) return;
    this.relay?.say({ do: 'words', match: taped.match, from: taped.sent, words: taped.words.slice(taped.sent) });
    taped.sent = taped.words.length;
  }

  private stop(why: string): void {
    this.sendTaped(true);
    this.taped = null;
    const playing = this.session !== null;
    this.session = null;
    this.tail = null;
    this.peering?.close();
    this.peering = null;
    this.transport = null;
    this.wire = null;
    this.theirs = null;
    this.starting = null;
    this.theyWait = false;
    this.ended = whyLine(why);
    if (this.state !== 'off' && this.state !== 'connecting') this.state = 'lobby';
    if (playing) this.options.game.end(why);
  }
}

/** A transport whose arrivals are each held `lagMs` before they are read: a slower link, to try a match over. */
class LateTransport implements Transport {
  private readonly held: { readonly at: number; readonly from: PeerId; readonly bytes: Uint8Array }[] = [];
  private readonly inner: Transport;
  private readonly lagMs: number;
  private readonly now: () => number;

  constructor(inner: Transport, lagMs: number, now: () => number) {
    this.inner = inner;
    this.lagMs = lagMs;
    this.now = now;
  }

  get state(): TransportState {
    return this.inner.state;
  }

  get self(): PeerId {
    return this.inner.self;
  }

  send(to: PeerId, message: Uint8Array): void {
    this.inner.send(to, message);
  }

  drain(into: MessageSink): void {
    const now = this.now();
    this.inner.drain((from, bytes) => this.held.push({ at: now, from, bytes: bytes.slice() }));
    let due = 0;
    while (due < this.held.length && now - this.held[due]!.at >= this.lagMs) due += 1;
    for (const one of this.held.splice(0, due)) into(one.from, one.bytes);
  }

  close(): void {
    this.inner.close();
  }
}
