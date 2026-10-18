/**
 * Online play on the page: what ONLINE MODE's page asks carried out (`Online`, `src/net/`), its
 * settings kept on this device, and the page told how the connection goes. A match is played in
 * place of the local game: the game's state is saved, both sides make the same start (the state the
 * game powers on with, the host's options, both players' buttons, Versus with both pads in) and play
 * it a field at a time from both pads' words; at the match's end the saved state comes back, on
 * ONLINE MODE's page. While a text is entered there (a room's code, the name, the server's address)
 * the keyboard and the mouse edit it as a text field (`text-field.ts`), the clipboard with them;
 * while a match is played, a line over the picture says how its connection goes.
 */
import { ALSO_PLAYS, Online, PLAYS_AS, REMATCH_MS, type Start } from '../net/online.ts';
import { serverAddresses } from '../net/address.ts';
import { StateSnapshotter } from '../net/snapshot.ts';
import { ROLLBACK_DEPTH } from '../net/session.ts';
import { mirroredStick } from '../net/wire.ts';
import type { FightData } from '../sim/fight/state.ts';
import { stopMusic } from '../sim/fight/voices.ts';
import { Game } from '../sim/game/game.ts';
import { MenuMode, mapPads, startMode, wallsFor } from '../sim/game/menu.ts';
import { FightStep } from '../sim/game/fight-scene.ts';
import { lookOf } from '../sim/game/select.ts';
import { CODE_LENGTH, CODE_LETTERS, caretAt, DEFAULT_DELAY, Editing, MOST_DELAY, ONLINE_PAGE, OnlineScreen, OnlineStatus, TYPED_ENTER, TYPED_ESCAPE, typing } from '../sim/game/online-page.ts';
import { printRuns } from '../sim/game/printer.ts';
import { Scene, type GameState, type SceneDraw } from '../sim/game/state.ts';
import { SCREEN } from '../present/scenes/screen.ts';
import { canvas, params } from './page.ts';
import { freeCameraBarred } from './free-camera.ts';
import { MatchJournal, type FieldSound } from './match-journal.ts';
import { addressBounds, ClipboardBridge, codeBounds, copied, edit, insert, nameBounds, placeCaret, type Bounds, type Field } from './text-field.ts';
import { touchDevice } from './touch.ts';
import { TouchTyping, type Typed } from './touch-typing.ts';

/** Where the page's settings are kept on this device. */
const KEPT = 'tekken3-online';
/** The options the host's game decides for both. */
const DECIDED = ['difficulty', 'rounds', 'roundTime', 'alwaysChip', 'continueChooses', 'modeSetting', 'keepChoices', 'musicSet', 'stereo'] as const;
/** The scenes past an online match: its fight over (Versus's select again), or a reset. */
const PAST_VERSUS = new Set<number>([Scene.BOOT, Scene.LOGO, Scene.TITLE, Scene.MENU, Scene.OPTIONS, Scene.ATTRACT, Scene.SELECT, Scene.VS_SELECT]);
/** The scenes a reset goes to, as against Versus's own select after its fight. */
const RESET_TO = new Set<number>([Scene.BOOT, Scene.LOGO, Scene.TITLE, Scene.MENU, Scene.OPTIONS, Scene.ATTRACT]);
/** Fields past Versus that end an online match: past the rollback window (`ROLLBACK_DEPTH`), so no guess is left in them. */
const PAST_FIELDS = ROLLBACK_DEPTH + 4;
/** The last roster id whose home stage an online match may be drawn on (Kazuya's, past it, has none of his own). */
const LAST_STAGE_ROSTER = 0x15;
/** The fields of a match's presses the page's probe keeps. */
const PRESSES_KEPT = 600;
/** The state's fields that are this machine's own, never the match's: left out of the fingerprint. */
const OWN = ['remake', 'online'];
/** A watched fight: how far behind its players' presses it plays (fields), how far behind it catches up at once, and the most fields it plays in a frame doing so. */
const LIVE_LAG = 30;
const CATCH_UP = 120;
const CATCH_UP_FIELDS = 600;
/** The pad's buttons a watched fight's menu reads: start, select, up and down, and those that choose. */
const [START, SELECT, UP, DOWN, CHOOSE] = [0x800, 0x100, 0x1000, 0x4000, 0x8f0];
/** A watched fight's menu: its card's middle across the fight's screen, its top, its half width and its height; SPECTATING's line at the foot (the game's streaks' own). */
const OVERLAY = { centre: 0xc0, top: 150, half: 150, height: 150, foot: 0x1b0 } as const;

/** A streak of wins as a player is shown it: none under one. */
const winsLine = (wins: number): string => (wins > 0 ? `WINS ${wins}` : '');

const STATUS: Readonly<Record<string, number>> = { off: OnlineStatus.OFF, connecting: OnlineStatus.CONNECTING, lobby: OnlineStatus.LOBBY, queued: OnlineStatus.QUEUED, offered: OnlineStatus.OFFERED, hosting: OnlineStatus.HOSTING, joining: OnlineStatus.JOINING, greeting: OnlineStatus.GREETING, playing: OnlineStatus.PLAYING, result: OnlineStatus.RESULT, ended: OnlineStatus.LOBBY };

interface Kept {
  delay: number;
  listed: number;
  side: number;
  name: string;
  server: string;
  /** This player's id, by which a server counts their streak of wins: made once, at random. */
  id: string;
}

/** A new player's id: 128 bits at random, as hex digits. */
const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

function readKept(): Kept {
  const fallback: Kept = { delay: DEFAULT_DELAY, listed: 0, side: 0, name: 'PLAYER', server: '', id: newId() };
  try {
    const raw = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Kept> | null;
    if (raw === null || typeof raw !== 'object') return fallback;
    return {
      delay: Number.isInteger(raw.delay) && raw.delay! >= 0 && raw.delay! <= MOST_DELAY ? raw.delay! : fallback.delay,
      listed: raw.listed === 1 ? 1 : 0,
      side: raw.side === 1 ? 1 : 0,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.slice(0, 12) : fallback.name,
      server: typeof raw.server === 'string' ? raw.server.slice(0, 96) : '',
      id: typeof raw.id === 'string' && /^[0-9a-f]{32}$/.test(raw.id) ? raw.id : fallback.id,
    };
  } catch {
    return fallback;
  }
}

function writeKept(kept: Kept): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(kept));
  } catch {
    /* Not kept where the page may not store. */
  }
}

/** The server's addresses to try (`serverAddresses`): `?server=`, else the page's setting. */
export function serverUrls(setting: string, page: { readonly protocol: string; readonly host: string } = location): string[] {
  return serverAddresses(params.get('server') ?? setting, page);
}

export interface OnlineHooks {
  /** The game's data, as a fresh game is made from it. */
  readonly data: Game['data'];
  /** Every match's data made so far (the snapshotters are told of each). */
  readonly matches: () => Iterable<FightData>;
  /** The fighters whose data this side has (their roster ids): the roster both sides must share. */
  readonly roster: readonly number[];
}

export class OnlinePlay {
  readonly online: Online<unknown>;
  private readonly game: Game;
  private readonly hooks: OnlineHooks;
  private readonly kept: Kept;
  /** The local game's state while a match is played, its snapshotter, and the data its fight was loaded with. */
  private local: { readonly snapshotter: StateSnapshotter<GameState>; readonly slot: ReturnType<StateSnapshotter<GameState>['create']>; readonly match: FightData | null } | null = null;
  /** The match's snapshotter, told of each match's data as it is made. */
  private match: StateSnapshotter<GameState> | null = null;
  private readonly readout: HTMLElement;
  /** On a touch screen, the box a text is entered in with the system's keyboard and paste. */
  private readonly touchTyping: TouchTyping | null;
  /** Whether a match just ended (the page shows its page again), and the fields the match has been past Versus. */
  private endedNow = false;
  private pastFields = 0;
  /** What the waiting room waits for again once a match is over (a quick match, a room), or null (ONLINE MODE's page then). */
  private resume: string | null = null;
  /** The last match's result as the card says it, and the matches this player and the other have won since they were paired. */
  private result: readonly [string, string] = ['', ''];
  private readonly score = [0, 0];
  /** Whether ONLINE MODE's page has called its server since it opened. */
  private called = false;
  /**
   * The fight watched, while one is: its room and match, how a field of it is played, the fields of
   * it played, whether its menu is open and the line picked on it, the songs a catch-up passed over,
   * and the pads last field (for presses).
   */
  private watched: { readonly code: string; readonly match: number; readonly step: (words: readonly [number, number], field: number) => void; played: number; paused: boolean; choice: number; songs: GameState['world']['sound']['commands'][number][]; pads: number } | null = null;
  /** The browser's clipboard for the page's text, and whether a drag over it is selecting. */
  private readonly clipboard = new ClipboardBridge();
  private dragging = false;

  constructor(game: Game, hooks: OnlineHooks) {
    this.game = game;
    this.hooks = hooks;
    this.kept = readKept();
    /* The player's id kept from the first visit on. */
    writeKept(this.kept);
    const online = game.state.online;
    Object.assign(online, { delay: this.kept.delay, listed: this.kept.listed, side: this.kept.side, name: this.kept.name, server: params.get('server') ?? this.kept.server });
    this.online = new Online({
      url: () => serverUrls(this.game.state.online.server),
      player: () => ({ name: this.kept.name, delay: this.kept.delay, keys: this.localKeys(), fighter: this.localFighter(), id: this.kept.id }),
      lagMs: Math.max(0, Number(params.get('netlag') ?? 0) || 0),
      game: {
        version: PLAYS_AS,
        plays: Object.keys(ALSO_PLAYS),
        roster: this.hooks.roster,
        keyChoices: this.hooks.data.scenes.keyBits.length,
        defaultKeys: this.hooks.data.scenes.powerOn.keys[0]!,
        fighterName: (fighter) => this.hooks.data.tables.roster.codes[fighter * 4]?.name ?? `FIGHTER ${fighter}`,
        options: (as) => this.decided(as),
        begin: (start, seat, as) => this.begin(start, seat, as),
        end: (why) => this.end(why),
        waiting: () => this.waitAgain(),
      },
    });
    this.readout = document.createElement('div');
    Object.assign(this.readout.style, { position: 'fixed', top: '6px', left: '50%', transform: 'translateX(-50%)', font: "12px 'Russo One', sans-serif", color: '#fff', textShadow: '0 1px 2px #000, 0 0 4px #000', whiteSpace: 'pre', textAlign: 'center', pointerEvents: 'none', opacity: '0.85', display: 'none' });
    document.body.append(this.readout);
    const { phone, touchScreen } = touchDevice();
    this.touchTyping =
      phone || touchScreen
        ? new TouchTyping({
            field: () => this.field(),
            setField: (field) => this.setField(field),
            bounds: () => this.bounds(),
            ended: (kept) => (this.game.state.online.typed += kept ? TYPED_ENTER : TYPED_ESCAPE),
          })
        : null;
    document.addEventListener('keydown', (event) => this.typed(event), { capture: true });
    /* A page put out of sight runs no fields: the server told at once that this player is not to be offered anyone. */
    document.addEventListener('visibilitychange', () => this.online.setAvailable(this.inWaitingFight()));
    /* No free camera in online play (it holds the game, and the other side's goes on) or over a text being typed. */
    freeCameraBarred.now = () => this.local !== null || this.game.state.online.warming !== 0 || typing(this.game.state);
    canvas.addEventListener('pointerdown', (event) => this.pointed(event, false));
    addEventListener('pointermove', (event) => this.pointed(event, true));
    addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('dblclick', () => {
      if (this.editable()) this.setField({ value: this.field().value, caret: this.field().value.length, anchor: 0 });
    });
  }

  /** The match's fields as played, kept until final (`match-journal.ts`): their sound sent then, the picture held over a knockout not yet final. */
  private journal = new MatchJournal();

  private noteField(field: number): void {
    const state = this.game.state;
    const world = state.world;
    const sound = { sound: { commands: [...world.sound.commands], vabs: [...world.sound.vabs], theater: world.sound.theater }, frameRan: world.frameRan, vblank: state.vblanks };
    this.journal.note(field, sound, state.scene === Scene.FIGHT && (world.fighters[0]!.health === 0 || world.fighters[1]!.health === 0));
  }

  /** The sound of each field played that is final now (the other side's words for it in), not given out before, in order. */
  finalSounds(): FieldSound[] {
    const session = this.online.session;
    if (session === null) return [];
    const sounds = this.journal.finalSounds(session.final);
    for (const { sound, vblank } of sounds) {
      const keyed = sound.commands.filter((c) => c.key === 'on').length;
      if (keyed > 0) this.heard.set(vblank, keyed);
    }
    for (const at of this.heard.keys()) if (this.heard.size > PRESSES_KEPT) this.heard.delete(at);
    return sounds;
  }

  /** The match's newest sounds given out, for the page's probe: each field's vertical blank and the voices it keyed on. */
  private readonly heard = new Map<number, number>();

  /**
   * Whether the picture holds as it is: the newest field has a fighter knocked out in a knockout
   * not final yet, which a word of the other side's still to come may take back. Once final the
   * fight is drawn on, the knockout in it; taken back, it was never seen.
   */
  get holding(): boolean {
    const session = this.online.session;
    return session !== null && this.local !== null && this.journal.holding(session.final);
  }

  /** The match's newest presses, for the page's probe: each field's pads' words and the game's buttons newly down for them, by field (a field played again in a rollback put right). */
  private readonly presses = new Map<number, readonly [number, number, number, number]>();

  private notePresses(field: number, words: readonly [number, number]): void {
    const pressed = this.game.state.world.input.pads.pressed;
    if (pressed[0] === 0 && pressed[1] === 0) this.presses.delete(field);
    else this.presses.set(field, [words[0], pressed[0]!, words[1], pressed[1]!]);
    for (const at of this.presses.keys()) if (at < field - PRESSES_KEPT) this.presses.delete(at);
  }

  /** For the page's probe: where online play is, and the match's connection while one is played. */
  probe(): Record<string, unknown> {
    const session = this.online.session;
    const page = this.game.state.online;
    const presses = [...this.presses.entries()].sort(([a], [b]) => a - b).map(([field, [raw0, game0, raw1, game1]]) => ({ field, pads: [raw0.toString(16), raw1.toString(16)], buttons: [game0.toString(16), game1.toString(16)] }));
    const watched = this.watched;
    const tape = this.online.tape;
    const watching = watched === null || tape === null ? null : { code: watched.code, match: watched.match, played: watched.played, have: Math.min(tape.words[0].length, tape.words[1].length), paused: watched.paused };
    return { state: this.online.state, watching, fights: this.online.fights.length, page: { status: page.status, warming: page.warming, card: page.card, answer: page.answer, fresh: this.game.state.world.input.fresh[0], available: this.inWaitingFight(), practicePaused: this.game.state.practice.paused }, ...(session === null ? {} : { field: session.tick, session: session.state, ahead: session.ahead, ...session.quality, theyWait: this.online.theyWait, direct: this.online.direct, presses, heard: [...this.heard.entries()] }) };
  }

  /** While a match is played, each seat's player's name (the host's first), for the HUD to show under the fighters'. */
  get players(): readonly [string, string] | null {
    const tape = this.watched !== null ? this.online.tape : null;
    if (tape !== null) return tape.names;
    if (this.local === null) return null;
    return this.online.seat === 0 ? [this.kept.name, this.online.opponent] : [this.online.opponent, this.kept.name];
  }

  /** While a match is played, each seat's player's streak of wins (0 none, or none counted), for the HUD to show at the foot. */
  get streaks(): readonly [number, number] | null {
    const tape = this.watched !== null ? this.online.tape : null;
    if (tape !== null) return tape.wins;
    if (this.local === null) return null;
    const [own, other] = [Math.max(0, this.online.wins), Math.max(0, this.online.opponentWins)];
    return this.online.seat === 0 ? [own, other] : [other, own];
  }

  /** Whether a match is being played (the page steps it, not the local game). */
  get playing(): boolean {
    return this.local !== null;
  }

  /** Whether a fight under way is being watched (the page plays it from its players' presses, `watchField`). */
  get watching(): boolean {
    return this.watched !== null;
  }

  /**
   * Whether the match is past its fight (Versus's select again, or a reset), its last fields played
   * until no rollback can reach back before them: neither drawn nor heard, the fight's last picture
   * held over them.
   */
  get ending(): boolean {
    return this.local !== null && PAST_VERSUS.has(this.game.state.scene);
  }

  /** A match's data, made: its objects copied by reference in the match's saved states. */
  shared(data: FightData): void {
    this.match?.share(data);
  }

  /** The fighter this player chose in the waiting room (its human's side). */
  private localFighter(): { roster: number; costume: number } {
    const state = this.game.state;
    const side = state.world.match.streakSide & 1;
    return { roster: state.entrants.roster[side]!, costume: state.entrants.costume[side]! };
  }

  /** This player's buttons: the first pad's key configuration. */
  private localKeys(): readonly number[] {
    return [...this.game.state.options.keys[0]!];
  }

  /** The host's options for the match, its stage (the home stage of a fighter both have, at random), and its walls (REACHABLE WALLS's for an online match). */
  /** The host's options for a match played as version `as`: the walls where it is this release's own, none (nor a word of them) against an older one. */
  private decided(as: string): Record<string, unknown> {
    const { options, records } = this.game.state;
    const homes = this.hooks.roster.filter((fighter) => fighter <= LAST_STAGE_ROSTER);
    const stage = (homes[crypto.getRandomValues(new Uint32Array(1))[0]! % Math.max(1, homes.length)] ?? 0) * 4;
    const walls = as === PLAYS_AS ? { walls: wallsFor(MenuMode.VERSUS, this.game.state.remake.settings.walls, true) } : {};
    return { ...Object.fromEntries(DECIDED.map((key) => [key, options[key]])), earnedRoster: records.earnedRoster, extraCostumes: records.extraCostumes, stage, ...walls };
  }

  /**
   * After a local field: what ONLINE MODE's page asked carried out, its settings kept, and the page
   * told how the connection goes; the connection's own frame (its pings) while no match is played.
   */
  afterField(): void {
    const online = this.game.state.online;
    const ask = online.ask;
    online.ask = '';
    switch (ask) {
      case 'quick':
        this.resume = ask;
        this.online.quickMatch();
        break;
      case 'host':
      case 'host listed':
        this.resume = ask;
        this.online.host(ask === 'host listed');
        break;
      case 'join':
        this.resume = null;
        this.online.join(online.code);
        break;
      case 'rooms':
        this.online.connect();
        this.online.listRooms(true);
        break;
      case 'unlist':
        this.online.listRooms(false);
        break;
      case 'fights':
        this.online.listFights(true);
        break;
      case 'unfights':
        this.online.listFights(false);
        break;
      case 'watch':
        this.resume = null;
        this.online.watch(online.code);
        break;
      case 'cancel':
        this.resume = null;
        this.online.cancel();
        break;
      case 'accept':
      case 'decline':
        this.online.answer(ask === 'accept');
        break;
      case 'rematch':
      case 'no rematch':
        this.online.rematch(ask === 'rematch');
        break;
      case 'leave':
        this.online.disconnect();
        break;
      case 'server':
        this.online.disconnect();
        this.called = false;
        break;
    }
    /* ONLINE MODE's page open: its server called as the page opens (and again once its address changes), so its players are counted there. */
    const state = this.game.state;
    if (state.scene !== Scene.OPTIONS || state.optionsScreen.page !== ONLINE_PAGE) this.called = false;
    else if (!this.called && this.online.state === 'off') {
      this.called = true;
      this.online.connect();
    }
    if (online.delay !== this.kept.delay || online.listed !== this.kept.listed || online.side !== this.kept.side || online.name !== this.kept.name || (online.server !== this.kept.server && params.get('server') === null)) {
      Object.assign(this.kept, { delay: online.delay, listed: online.listed, side: online.side, name: online.name, server: params.get('server') === null ? online.server : this.kept.server });
      writeKept(this.kept);
    }
    const pasted = this.clipboard.take();
    if (pasted !== null && this.editable()) this.setField(insert(this.field(), pasted, this.bounds()));
    this.online.setAvailable(this.inWaitingFight());
    /* A fight asked to be watched, its record in: watched from now on (`watchField`). */
    if (this.online.state === 'watching' && this.online.tape !== null && this.watched === null) this.startWatching();
    this.touchTyping?.frame(this.editable() ? this.typedNow() : null);
    this.online.frame(0);
    this.tell();
  }

  /** What is being entered, as the touch screen's box names it. */
  private typedNow(): Typed {
    const online = this.game.state.online;
    if (online.screen === OnlineScreen.CODE) return { label: 'ROOM CODE', address: false };
    return online.editing === Editing.NAME ? { label: 'YOUR NAME', address: false } : { label: 'SERVER ADDRESS', address: true };
  }

  /** Whether this player is in the waiting room's fight, playing (not loading it, not in Practice's menu, not choosing a character), the page in sight: offered an opponent only then. */
  private inWaitingFight(): boolean {
    const state = this.game.state;
    return state.online.warming === 2 && state.scene === Scene.FIGHT && state.step === FightStep.FIGHTING && state.practice.paused === 0 && state.world.pause.paused === 0 && document.visibilityState === 'visible';
  }

  /** The page's lines: how the connection goes, in the game's words. */
  private tell(): void {
    const online = this.game.state.online;
    const o = this.online;
    online.status = STATUS[o.state] ?? OnlineStatus.OFF;
    online.rooms = o.rooms.map((room) => ({ ...room }));
    online.fights = o.fights.map((fight) => ({ ...fight }));
    const address = serverUrls(online.server)[0] ?? 'NONE SET';
    const server = o.server !== '' ? o.server : address.replace(/^wss?:\/\//, '').toUpperCase();
    switch (o.state) {
      case 'connecting':
        online.lines = ['CONNECTING TO THE SERVER', address.replace(/^wss?:\/\//, '').toUpperCase()];
        break;
      case 'queued':
        online.lines = ['SEARCHING FOR AN OPPONENT', server];
        break;
      case 'hosting':
        online.lines = ['WAITING FOR AN OPPONENT', `ROOM ${o.code}`, online.listed !== 0 ? 'LISTED IN THE ROOM LIST' : 'GIVE THIS CODE TO THE OTHER PLAYER', server];
        break;
      case 'joining':
        online.lines = ['JOINING THE ROOM', `ROOM ${o.code}`, server];
        break;
      case 'offered':
        online.lines = ['OPPONENT FOUND', o.opponent];
        online.offerLeft = o.offerSeconds > 0 ? o.offerLeft / o.offerSeconds : 0;
        online.answer = o.answered === null ? 0 : o.answered ? 1 : 2;
        break;
      case 'greeting':
      case 'playing':
        online.lines = ['OPPONENT FOUND', o.opponent];
        break;
      case 'result':
        online.lines = [...this.result];
        online.offerLeft = o.resultLeft / (REMATCH_MS / 1000);
        online.answer = o.rematchMine === null ? 0 : o.rematchMine ? 1 : 2;
        break;
      default: {
        const first = o.state === 'lobby' ? `CONNECTED TO ${server}${o.motd !== '' ? `  ${o.motd.toUpperCase()}` : ''}` : `SERVER ${server}`;
        online.lines = o.ended !== '' ? [first, o.ended] : [first];
      }
    }
    /* How many are about, while the server is heard from (its pongs carry it). */
    const heard = o.state !== 'off' && o.state !== 'connecting' && 0 <= o.players;
    online.players = heard ? `${o.players} ${o.players === 1 ? 'PLAYER' : 'PLAYERS'} ONLINE${0 <= o.queued ? `  ${o.queued} SEARCHING` : ''}` : '';
    online.wins = heard ? winsLine(o.wins) : '';
  }

  /**
   * One field of the match, from this player's pad: played if this side is ready (its fight's data
   * and drawing loaded), the other told to wait if not; on the fight's last loading field
   * (`atStart`), once both are. Whether a field was played. A match that ends (or whose game leaves
   * Versus) brings the local game back.
   */
  matchField(word: number, ready: boolean, atStart: boolean): boolean {
    this.endedNow = false;
    /* The stick goes by the screen: on a mirrored fight, its left is the game's right. */
    const pressed = this.mirrored ? mirroredStick(word) : word;
    const played = this.online.frame(pressed, ready, atStart);
    /* Over once past Versus for longer than a rollback reaches: every press behind it in, on both sides alike. */
    if (played) this.pastFields = PAST_VERSUS.has(this.game.state.scene) ? this.pastFields + 1 : 0;
    if (this.local !== null && PAST_FIELDS < this.pastFields) {
      /* A reset is this player leaving: back to the page, not the waiting room. Versus's select again, the match's result. */
      if (RESET_TO.has(this.game.state.scene)) {
        this.resume = null;
        this.online.leaveMatch();
      } else {
        const winner = this.winner();
        this.result = this.resultLines(winner);
        this.online.matchOver(winner);
      }
    }
    this.showReadout();
    return played || this.endedNow;
  }

  /**
   * Whether an online match's fight is seen mirrored: where this player's side (SIDE, the left by
   * default) is not the seat the server gave them (the host's the left, the guest's the right).
   */
  get mirroredSide(): boolean {
    return this.local !== null && this.watched === null && (this.online.seat === 1) !== (this.kept.side === 1);
  }

  /** The seat that won the match, from Versus's record (each match starts it afresh), or -1 for a draw. */
  private winner(): number {
    const { wins } = this.game.state.run.versusRecord;
    return wins[0]! > 0 ? 0 : wins[1]! > 0 ? 1 : -1;
  }

  /**
   * The match's result, `side` the seat that won it (-1 a draw): who won, by their fighter's name,
   * and for this player whether they won, with the score since they were paired.
   */
  private resultLines(side: number): readonly [string, string] {
    const state = this.game.state;
    if (side === this.online.seat) this.score[0]! += 1;
    else if (side !== -1) this.score[1]! += 1;
    const tally = `${this.score[0]} - ${this.score[1]}`;
    if (side === -1) return ['DRAW GAME', tally];
    const name = this.hooks.data.tables.roster.codes[state.entrants.roster[side]! * 4]?.name ?? '';
    return [`${name} WINS`.trim(), `${side === this.online.seat ? 'YOU WIN' : 'YOU LOSE'}  ${tally}`];
  }

  /** Whether the fight is played mirrored now: its side mirrored, and the fight itself on. */
  private get mirrored(): boolean {
    return this.mirroredSide && this.game.state.scene === Scene.FIGHT && this.game.state.drewFight !== 0;
  }

  /** This side's own seat's motors, as the first pad's. */
  ownRumble(out: readonly (readonly number[])[]): readonly (readonly number[])[] {
    return [out[this.online.seat] ?? [0, 0], [0, 0]];
  }

  private begin(start: Start, seat: 0 | 1, as: string): { step: (words: readonly [number, number], field: number) => void; snapshotter: StateSnapshotter<GameState> } {
    const game = this.game;
    /* A rematch counts on; a new opponent from nothing. */
    if (this.online.state !== 'result') this.score.fill(0);
    const state = game.state;
    const own = { settings: { ...state.remake.settings }, started: { ...state.remake.started }, made: state.remake.remasterMade };
    const page = { ...state.online, lines: [...state.online.lines], rooms: [...state.online.rooms] };
    const snapshotter = new StateSnapshotter(state);
    this.shareData(snapshotter);
    const slot = snapshotter.create();
    snapshotter.save(slot);
    this.local = { snapshotter, slot, match: game.fightData };
    /* Both sides alike: the power-on state, the host's options and both players' buttons, Versus. */
    snapshotter.restore(new Game(game.data).state as unknown as Parameters<typeof snapshotter.restore>[0]);
    for (const key of DECIDED) if (typeof start.options[key] === 'number') state.options[key] = start.options[key] as number;
    if (typeof start.options.earnedRoster === 'number') state.records.earnedRoster = start.options.earnedRoster;
    if (typeof start.options.extraCostumes === 'number') state.records.extraCostumes = start.options.extraCostumes;
    state.options.keys.splice(0, 2, [...start.keys[0]], [...start.keys[1]]);
    state.options.vibration.fill(1);
    mapPads(state, game.data.scenes);
    stopMusic(state.world);
    startMode(state, MenuMode.VERSUS, 1);
    /* Online: straight to the fight, each player's fighter as chosen in the waiting room, the stage the host drew. */
    state.run.online = 1;
    /* Three rounds to win (the option is the rounds less one), whatever the host's options; a round's end cut short by both players alone. */
    state.world.options.rounds = 2;
    state.world.match.online = 1;
    /* A level round that brings both to the rounds that win the match a draw, where both games agreed it, rather than the host's by the game's tie-break. */
    if (start.draws === 1) state.world.match.drawRule = 1;
    /* The remake's walls as the host's REACHABLE WALLS has them for an online match; none in one played as an older version. */
    state.world.options.walls = as === PLAYS_AS && start.options.walls === 1 ? 1 : 0;
    state.run.onlineStage = typeof start.options.stage === 'number' ? start.options.stage : -1;
    start.fighters.forEach((fighter, n) => {
      state.entrants.roster[n] = fighter.roster;
      state.entrants.costume[n] = fighter.costume;
      state.entrants.chosen[n] = 1;
      state.entrants.computer[n] = 0;
      state.versusPortraits[n] = lookOf(game.data.scenes, fighter.roster, fighter.costume) & 0x1f;
    });
    state.modeOverlay = state.run.overlay;
    Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
    /* This machine's own: how it draws, and its page as it was, but the waiting room's practice, which is over. */
    Object.assign(state.remake.settings, own.settings);
    Object.assign(state.remake.started, own.started);
    state.remake.remasterMade = own.made;
    Object.assign(state.online, page, { warming: 0, ask: '', typed: '', card: 0, fight: Number.isInteger(start.match) && start.match > 0 ? start.match : 1 });
    this.pastFields = 0;
    /* Against an older version, the fields of the state it lacks left out of the fingerprint. */
    this.match = new StateSnapshotter(state, OWN, ALSO_PLAYS[as] ?? []);
    this.shareData(this.match);
    console.log(`[tekken3 online] a match with ${this.online.opponent}, this side the ${seat === 0 ? 'first' : 'second'} pad, input delay ${start.delay}, played as ${as}`);
    this.presses.clear();
    this.journal = new MatchJournal();
    this.heard.clear();
    return {
      step: (words, field) => {
        game.field(words);
        this.notePresses(field, words);
        this.noteField(field);
      },
      snapshotter: this.match,
    };
  }

  private shareData(snapshotter: StateSnapshotter<GameState>): void {
    snapshotter.share(this.hooks.data.tables);
    snapshotter.share(this.hooks.data.scenes);
    for (const data of this.hooks.matches()) snapshotter.share(data);
  }

  /**
   * The match over: the local game as it was, back in the waiting room, the sound stopped; its
   * result asked about there ('over'), else waiting again for what it waited for.
   */
  private end(why: string): void {
    const local = this.local;
    if (local === null) return;
    this.local = null;
    this.match = null;
    local.snapshotter.restore(local.slot);
    /* The local fight's own data with it: the match's movesets are not its fighters'. */
    this.game.fightData = local.match;
    stopMusic(this.game.state.world);
    if (why !== 'over') this.waitAgain();
    this.endedNow = true;
    this.readout.style.display = 'none';
    this.tell();
  }

  /** Back in the waiting room, waiting again for what it waited for (a joined room's guest goes back to the page). */
  private waitAgain(): void {
    if (this.resume === 'quick') this.online.quickMatch();
    else if (this.resume !== null) this.online.host(this.resume === 'host listed');
    this.tell();
  }

  /** The fight in the record the server gave begun, as its players began it: the local game kept to come back to. */
  private startWatching(): void {
    const tape = this.online.tape!;
    const { step } = this.begin(tape.start, 0, tape.as);
    /* Every button taken as held, so the press that chose the fight opens nothing: a press counts once released. */
    this.watched = { code: tape.code, match: tape.match, step, played: 0, paused: false, choice: 0, songs: [], pads: 0xffff };
  }

  /** No longer watching: the local game as it was (the fights' list), the fights asked for again. */
  private stopWatching(): void {
    this.online.unwatch();
    if (this.watched === null) return;
    this.watched = null;
    this.end('watched');
    this.online.listFights(true);
  }

  /**
   * A field of the page while a fight is watched, `pads` this player's: start opens its menu (and
   * closes it), whose lines CONTINUE and LEAVE are picked up and down and chosen by a button, select
   * closing it. Otherwise, with the fight's drawing ready, its fields played from its players'
   * presses: where it is far behind them, as many as bring it near, at once and unheard (their songs
   * kept for the next heard); else one a field (two where it falls behind), a moment behind them,
   * each heard (`heard`, with the songs passed over first). A new match of the same two (a rematch)
   * begun anew; the fight over, the fights' list again. Whether a field was played.
   */
  watchField(pads: number, ready: boolean, heard: (songs: readonly GameState['world']['sound']['commands'][number][]) => void): boolean {
    const watched = this.watched;
    if (watched === null) return false;
    const tape = this.online.tape;
    if (this.online.state !== 'watching' || tape === null) {
      this.stopWatching();
      return true;
    }
    if (tape.code !== watched.code || tape.match !== watched.match) {
      this.watched = null;
      this.end('watched');
      this.startWatching();
      return true;
    }
    const fresh = pads & ~watched.pads;
    watched.pads = pads;
    if (watched.paused) {
      if ((fresh & (UP | DOWN)) !== 0) watched.choice ^= 1;
      if ((fresh & SELECT) !== 0 || ((fresh & CHOOSE) !== 0 && watched.choice === 0)) watched.paused = false;
      else if ((fresh & CHOOSE) !== 0) {
        this.stopWatching();
        return true;
      }
      this.showReadout();
      return false;
    }
    if ((fresh & START) !== 0) {
      watched.paused = true;
      watched.choice = 0;
      this.showReadout();
      return false;
    }
    const words = tape.words;
    const have = Math.min(words[0].length, words[1].length);
    const behind = have - watched.played;
    const play = (): void => {
      const field = watched.played;
      watched.step([words[0][field]!, words[1][field]!], field);
      watched.played += 1;
    };
    let played = false;
    if (ready && CATCH_UP < behind) {
      /* Far behind: brought near at once, unheard, but for the songs it passes over. */
      for (let k = 0; k < Math.min(behind - LIVE_LAG, CATCH_UP_FIELDS) && !this.game.blocked(); k += 1) {
        play();
        watched.songs.push(...this.game.state.world.sound.commands.filter((command) => command.key === 'song'));
        played = true;
      }
    } else if (ready && LIVE_LAG < behind) {
      for (let k = 0; k < (2 * LIVE_LAG < behind ? 2 : 1) && !this.game.blocked(); k += 1) {
        play();
        heard(watched.songs.splice(0));
        played = true;
      }
    }
    this.showReadout();
    return played;
  }

  /** Whether a watched fight's menu is open (the picture drawn though no field plays under it). */
  get watchMenuOpen(): boolean {
    return this.watched?.paused === true;
  }

  /**
   * What a watched fight shows over it, as the game prints and draws over a fight (in its units,
   * `FIGHT_SCREEN`): SPECTATING at the foot, in the middle; and while its menu is open, a card with
   * the two players, CONTINUE and LEAVE, the one picked on a bar.
   */
  watchOverlay(): Pick<GameState, 'printed' | 'drawn'> | null {
    const watched = this.watched;
    const tape = this.online.tape;
    if (watched === null || tape === null) return null;
    const out: Pick<GameState, 'printed' | 'drawn'> = { printed: [], drawn: [] };
    const centre = OVERLAY.centre;
    const at = (text: string, y: number, colour: number, font = 0): void => {
      out.printed.push(...printRuns(font, colour, centre - ((text.length * (font === 0 ? 9 : 13)) >> 1), y, text).runs);
    };
    at('SPECTATING', OVERLAY.foot, 6, 1);
    if (!watched.paused) return out;
    const tile = (x: number, y: number, w: number, h: number, colour: number, layer: number): void => {
      out.drawn.push({ kind: 'tile', x, y, w, h, colour, layer, at: out.printed.length } as SceneDraw);
    };
    const { top, half, height } = OVERLAY;
    at('SPECTATING', top + 14, 6, 1);
    at(`${tape.names[0]}  VS  ${tape.names[1]}`, top + 48, 5);
    ['CONTINUE', 'LEAVE'].forEach((line, i) => {
      const y = top + 82 + i * 26;
      if (i === watched.choice) tile(centre - 70, y - 3, 140, 22, 0x2040d0, 6);
      at(line, y, i === watched.choice ? 5 : 10);
    });
    tile(centre - half, top, half * 2, height, 0x000000, 5);
    tile(centre - half - 2, top - 2, half * 2 + 4, height + 4, 0xc0c0c0, 5);
    return out;
  }

  private showReadout(): void {
    const watched = this.watched;
    const tape = this.online.tape;
    if (watched !== null && tape !== null) {
      const behind = Math.min(tape.words[0].length, tape.words[1].length) - watched.played;
      this.readout.textContent = `${tape.names[0]}  VS  ${tape.names[1]}${!watched.paused && CATCH_UP < behind ? '   CATCHING UP' : ''}`;
      this.readout.style.display = 'block';
      return;
    }
    const quality = this.online.quality;
    if (quality === null || this.local === null) {
      this.readout.style.display = 'none';
      return;
    }
    const session = this.online.session!;
    const older = this.online.playsAs !== PLAYS_AS ? `   AS ${this.online.playsAs}, NO WALLS` : '';
    const lines = [`VS ${this.online.opponent}   ${Math.round(quality.roundTripMs)} MS   DELAY ${quality.inputDelay}   ROLLBACKS ${quality.rollbacks}${quality.deepest > 0 ? ` (UP TO ${quality.deepest})` : ''}   ${this.online.direct ? 'DIRECT' : 'VIA SERVER'}${older}`];
    if (this.online.theyWait) lines.push(`${this.online.opponent} IS LOADING`);
    else if (this.online.holding || (session.state === 'stalled' && session.stalling > 20)) lines.push(`WAITING FOR ${this.online.opponent}`);
    else {
      /* A round's end this player asked to cut short, the other not yet. */
      const asks = this.game.state.world.match.skipAsks;
      const mine = 1 << this.online.seat;
      if ((asks & mine) !== 0 && (asks & (3 ^ mine)) === 0) lines.push(`WAITING FOR ${this.online.opponent} TO SKIP`);
    }
    this.readout.textContent = lines.join('\n');
    this.readout.style.display = 'block';
  }

  /** Whether a text is being entered on ONLINE MODE's page now (no match played). */
  private editable(): boolean {
    return this.local === null && typing(this.game.state);
  }

  /** The text being entered: the code, or the name or the address, with its caret and selection. */
  private field(): Field {
    const online = this.game.state.online;
    return { value: online.screen === OnlineScreen.CODE ? online.code : online.text, caret: online.caret, anchor: online.anchor };
  }

  private setField(field: Field): void {
    const online = this.game.state.online;
    if (online.screen === OnlineScreen.CODE) online.code = field.value;
    else online.text = field.value;
    online.caret = field.caret;
    online.anchor = field.anchor;
  }

  private bounds(): Bounds {
    const online = this.game.state.online;
    if (online.screen === OnlineScreen.CODE) return codeBounds(CODE_LETTERS, CODE_LENGTH);
    return online.editing === Editing.NAME ? nameBounds : addressBounds;
  }

  /**
   * A key while a text is entered: the field's, never a pad's; Enter and Escape for the page to keep
   * or leave it. Copy, cut and paste go on to the browser (only past the pads), whose clipboard
   * events carry their text.
   */
  private typed(event: KeyboardEvent): void {
    if (!this.editable() || event.altKey || this.touchTyping?.owns(event.target) === true) return;
    const online = this.game.state.online;
    if (event.key === 'Enter' || event.key === 'Escape') {
      online.typed += event.key === 'Enter' ? TYPED_ENTER : TYPED_ESCAPE;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const before = this.field();
    const out = edit(before, { key: event.key, control: event.ctrlKey || event.metaKey, shift: event.shiftKey }, this.bounds());
    if (!out.took && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.stopPropagation();
    if (out.clipboard === null) event.preventDefault();
    this.setField(out.field);
    if (out.clipboard === 'paste') this.clipboard.ask();
    else if (out.clipboard !== null) this.clipboard.write(copied(before));
  }

  /** The mouse over the text being entered: a press puts the caret where it is (Shift, the selection to there), a drag selects. */
  private pointed(event: PointerEvent, moving: boolean): void {
    if (!this.editable() || (moving && (!this.dragging || (event.buttons & 1) === 0))) return;
    const rect = canvas.getBoundingClientRect();
    const across = (rect.height * 4) / 3;
    const x = ((event.clientX - rect.left - (rect.width - across) / 2) * SCREEN.width) / across;
    const y = ((event.clientY - rect.top) * SCREEN.lines) / rect.height;
    const at = caretAt(this.game.state, x, y);
    if (at === null) return;
    if (!moving) this.dragging = true;
    this.setField(placeCaret(this.field(), at, moving || event.shiftKey));
  }
}
