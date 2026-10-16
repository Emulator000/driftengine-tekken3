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
import pkg from '../../package.json';
import { Online, REMATCH_MS, rosterWord, type Start } from '../net/online.ts';
import { StateSnapshotter } from '../net/snapshot.ts';
import { ROLLBACK_DEPTH } from '../net/session.ts';
import type { FightData } from '../sim/fight/state.ts';
import { stopMusic } from '../sim/fight/voices.ts';
import { Game } from '../sim/game/game.ts';
import { MenuMode, mapPads, startMode } from '../sim/game/menu.ts';
import { FightStep } from '../sim/game/fight-scene.ts';
import { lookOf } from '../sim/game/select.ts';
import { CODE_LENGTH, CODE_LETTERS, caretAt, DEFAULT_DELAY, Editing, MOST_DELAY, OnlineScreen, OnlineStatus, TYPED_ENTER, TYPED_ESCAPE, typing } from '../sim/game/online-page.ts';
import { Scene, type GameState } from '../sim/game/state.ts';
import { SCREEN } from '../present/scenes/screen.ts';
import { canvas, params } from './page.ts';
import { freeCameraBarred } from './free-camera.ts';
import { addressBounds, ClipboardBridge, codeBounds, copied, edit, insert, nameBounds, placeCaret, type Bounds, type Field } from './text-field.ts';

/** A pad's left and right. */
const LEFT = 0x8000;
const RIGHT = 0x2000;

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
/** The state's fields that are this machine's own, never the match's: left out of the fingerprint. */
const OWN = ['remake', 'online'];

const STATUS: Readonly<Record<string, number>> = { off: OnlineStatus.OFF, connecting: OnlineStatus.CONNECTING, lobby: OnlineStatus.LOBBY, queued: OnlineStatus.QUEUED, offered: OnlineStatus.OFFERED, hosting: OnlineStatus.HOSTING, joining: OnlineStatus.JOINING, greeting: OnlineStatus.GREETING, playing: OnlineStatus.PLAYING, result: OnlineStatus.RESULT, ended: OnlineStatus.LOBBY };

interface Kept {
  delay: number;
  listed: number;
  side: number;
  name: string;
  server: string;
}

function readKept(): Kept {
  const fallback: Kept = { delay: DEFAULT_DELAY, listed: 0, side: 0, name: 'PLAYER', server: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Kept> | null;
    if (raw === null || typeof raw !== 'object') return fallback;
    return {
      delay: Number.isInteger(raw.delay) && raw.delay! >= 0 && raw.delay! <= MOST_DELAY ? raw.delay! : fallback.delay,
      listed: raw.listed === 1 ? 1 : 0,
      side: raw.side === 1 ? 1 : 0,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.slice(0, 12) : fallback.name,
      server: typeof raw.server === 'string' ? raw.server.slice(0, 96) : '',
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

/**
 * The server's address: `?server=`, else the page's setting, else the relay the dev server runs
 * beside the page (`/relay` on its own address); a bare `host:port` taken as a WebSocket's, secure
 * where the page is. Null in an app with none set.
 */
export function serverUrl(setting: string, page: { readonly protocol: string; readonly host: string } = location): string | null {
  const raw = (params.get('server') ?? setting).trim();
  const secure = page.protocol === 'https:';
  if (raw === '') return page.protocol === 'http:' || page.protocol === 'https:' ? `${secure ? 'wss' : 'ws'}://${page.host}/relay` : null;
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws');
  return `${secure ? 'wss' : 'ws'}://${raw}`;
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
  private buildValue = '';
  /** The local game's state while a match is played, its snapshotter, and the data its fight was loaded with. */
  private local: { readonly snapshotter: StateSnapshotter<GameState>; readonly slot: ReturnType<StateSnapshotter<GameState>['create']>; readonly match: FightData | null } | null = null;
  /** The match's snapshotter, told of each match's data as it is made. */
  private match: StateSnapshotter<GameState> | null = null;
  private readonly readout: HTMLElement;
  /** Whether a match just ended (the page shows its page again), and the fields the match has been past Versus. */
  private endedNow = false;
  private pastFields = 0;
  /** What the waiting room waits for again once a match is over (a quick match, a room), or null (ONLINE MODE's page then). */
  private resume: string | null = null;
  /** The last match's result as the card says it, and the matches this player and the other have won since they were paired. */
  private result: readonly [string, string] = ['', ''];
  private readonly score = [0, 0];
  /** The browser's clipboard for the page's text, and whether a drag over it is selecting. */
  private readonly clipboard = new ClipboardBridge();
  private dragging = false;

  constructor(game: Game, hooks: OnlineHooks) {
    this.game = game;
    this.hooks = hooks;
    this.kept = readKept();
    const online = game.state.online;
    Object.assign(online, { delay: this.kept.delay, listed: this.kept.listed, side: this.kept.side, name: this.kept.name, server: params.get('server') ?? this.kept.server });
    const self = this;
    this.online = new Online({
      url: () => serverUrl(this.game.state.online.server),
      player: () => ({ name: this.kept.name, delay: this.kept.delay, keys: this.localKeys(), fighter: this.localFighter() }),
      lagMs: Math.max(0, Number(params.get('netlag') ?? 0) || 0),
      game: {
        get build() {
          return self.build;
        },
        fighterName: (fighter) => this.hooks.data.tables.roster.codes[fighter * 4]?.name ?? `FIGHTER ${fighter}`,
        options: () => this.decided(),
        begin: (start, seat) => this.begin(start, seat),
        end: (why) => this.end(why),
        waiting: () => this.waitAgain(),
      },
    });
    this.readout = document.createElement('div');
    Object.assign(this.readout.style, { position: 'fixed', top: '6px', left: '50%', transform: 'translateX(-50%)', font: "12px 'Russo One', sans-serif", color: '#fff', textShadow: '0 1px 2px #000, 0 0 4px #000', whiteSpace: 'pre', textAlign: 'center', pointerEvents: 'none', opacity: '0.85', display: 'none' });
    document.body.append(this.readout);
    document.addEventListener('keydown', (event) => this.typed(event), { capture: true });
    /* No free camera in online play (it holds the game, and the other side's goes on) or over a text being typed. */
    freeCameraBarred.now = () => this.local !== null || this.game.state.online.warming !== 0 || typing(this.game.state);
    canvas.addEventListener('pointerdown', (event) => this.pointed(event, false));
    addEventListener('pointermove', (event) => this.pointed(event, true));
    addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('dblclick', () => {
      if (this.editable()) this.setField({ value: this.field().value, caret: this.field().value.length, anchor: 0 });
    });
  }

  /** For the page's probe: where online play is, and the match's connection while one is played. */
  probe(): Record<string, unknown> {
    const session = this.online.session;
    const page = this.game.state.online;
    return { state: this.online.state, page: { status: page.status, warming: page.warming, card: page.card, answer: page.answer, fresh: this.game.state.world.input.fresh[0] }, ...(session === null ? {} : { field: session.tick, session: session.state, ahead: session.ahead, ...session.quality, theyWait: this.online.theyWait, direct: this.online.direct }) };
  }

  /** Whether a match is being played (the page steps it, not the local game). */
  get playing(): boolean {
    return this.local !== null;
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

  /**
   * The game both sides must share, as three words: the version, the roster (the fighters whose
   * data this side has) and the fingerprint of the game's tables and scenes but its models (an
   * arcade board's change them, as they change only the picture).
   */
  private get build(): string {
    if (this.buildValue === '') {
      const { tables, scenes } = this.hooks.data;
      const digest = new StateSnapshotter({ tables: { ...tables, models: null }, scenes }).digestNow();
      this.buildValue = `${pkg.version} ${rosterWord(this.hooks.roster)} ${digest}`;
    }
    return this.buildValue;
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

  /** The host's options for the match, and its stage: the home stage of a fighter both have, at random. */
  private decided(): Record<string, unknown> {
    const { options, records } = this.game.state;
    const homes = this.hooks.roster.filter((fighter) => fighter <= LAST_STAGE_ROSTER);
    const stage = (homes[crypto.getRandomValues(new Uint32Array(1))[0]! % Math.max(1, homes.length)] ?? 0) * 4;
    return { ...Object.fromEntries(DECIDED.map((key) => [key, options[key]])), earnedRoster: records.earnedRoster, extraCostumes: records.extraCostumes, stage };
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
        break;
    }
    if (online.delay !== this.kept.delay || online.listed !== this.kept.listed || online.side !== this.kept.side || online.name !== this.kept.name || (online.server !== this.kept.server && params.get('server') === null)) {
      Object.assign(this.kept, { delay: online.delay, listed: online.listed, side: online.side, name: online.name, server: params.get('server') === null ? online.server : this.kept.server });
      writeKept(this.kept);
    }
    const pasted = this.clipboard.take();
    if (pasted !== null && this.editable()) this.setField(insert(this.field(), pasted, this.bounds()));
    this.online.frame(0);
    this.tell();
  }

  /** The page's lines: how the connection goes, in the game's words. */
  private tell(): void {
    const online = this.game.state.online;
    const o = this.online;
    online.status = STATUS[o.state] ?? OnlineStatus.OFF;
    online.rooms = o.rooms.map((room) => ({ ...room }));
    const address = serverUrl(online.server) ?? 'NONE SET';
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
  }

  /**
   * One field of the match, from this player's pad: played if this side is ready (its fight's data
   * and drawing loaded), the other told to wait if not. Whether a field was played. A match that
   * ends (or whose game leaves Versus) brings the local game back.
   */
  matchField(word: number, ready: boolean): boolean {
    this.endedNow = false;
    /* The stick goes by the screen: on a mirrored fight, its left is the game's right. */
    const pressed = this.mirrored ? (word & ~(LEFT | RIGHT)) | ((word & LEFT) !== 0 ? RIGHT : 0) | ((word & RIGHT) !== 0 ? LEFT : 0) : word;
    const played = this.online.frame(pressed, ready);
    /* Over once past Versus for longer than a rollback reaches: every press behind it in, on both sides alike. */
    if (played) this.pastFields = PAST_VERSUS.has(this.game.state.scene) ? this.pastFields + 1 : 0;
    if (this.local !== null && PAST_FIELDS < this.pastFields) {
      /* A reset is this player leaving: back to the page, not the waiting room. Versus's select again, the match's result. */
      if (RESET_TO.has(this.game.state.scene)) {
        this.resume = null;
        this.online.leaveMatch();
      } else {
        this.result = this.resultLines();
        this.online.matchOver();
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
    return this.local !== null && (this.online.seat === 1) !== (this.kept.side === 1);
  }

  /**
   * The match's result, from Versus's record (each match starts it afresh): who won, by their
   * fighter's name, and for this player whether they won, with the score since they were paired.
   */
  private resultLines(): readonly [string, string] {
    const state = this.game.state;
    const { wins } = state.run.versusRecord;
    const side = wins[0]! > 0 ? 0 : wins[1]! > 0 ? 1 : -1;
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

  private begin(start: Start, seat: 0 | 1): { step: (words: readonly [number, number]) => void; snapshotter: StateSnapshotter<GameState> } {
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
    Object.assign(state.online, page, { warming: 0, ask: '', typed: '', card: 0 });
    this.pastFields = 0;
    this.match = new StateSnapshotter(state, OWN);
    this.shareData(this.match);
    console.log(`[tekken3 online] a match with ${this.online.opponent}, this side the ${seat === 0 ? 'first' : 'second'} pad, input delay ${start.delay}`);
    return { step: (words) => game.field(words), snapshotter: this.match };
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

  private showReadout(): void {
    const quality = this.online.quality;
    if (quality === null || this.local === null) {
      this.readout.style.display = 'none';
      return;
    }
    const session = this.online.session!;
    const lines = [`VS ${this.online.opponent}   ${Math.round(quality.roundTripMs)} MS   DELAY ${quality.inputDelay}   ROLLBACKS ${quality.rollbacks}${quality.deepest > 0 ? ` (UP TO ${quality.deepest})` : ''}   ${this.online.direct ? 'DIRECT' : 'VIA SERVER'}`];
    if (this.online.theyWait) lines.push(`${this.online.opponent} IS LOADING`);
    else if (session.state === 'stalled' && session.stalling > 20) lines.push(`WAITING FOR ${this.online.opponent}`);
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
    if (!this.editable() || event.altKey) return;
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
