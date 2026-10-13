/**
 * The whole game's state, a field at a time: the scene playing and its state, what the scenes
 * share (the attract cycle, the count most of them keep, the picture held), the pads' mapping and
 * repeats, the second random generator, and what the printer drew this field. The fight's state is
 * the game's world: the counters, pads, mode, entrants and options it holds are the game's own,
 * and the scenes read and write them there.
 */
import { blankFightState } from '../fight/blank.ts';
import type { FightState } from '../fight/state.ts';

/** The game's scenes, as it numbers them. */
export const Scene = {
  BOOT: 0,
  LOADER: 1,
  LOGO: 2,
  TITLE: 3,
  MENU: 4,
  OPTIONS: 5,
  ATTRACT: 6,
  MODE: 7,
  FIGHT: 8,
  SELECT: 9,
  VS_SELECT: 10,
  VERSUS: 0xb,
  RECORDS_LOADER: 0x10,
  RECORDS: 0x11,
  OVERLAY_LOADER: 0x12,
  MOVIE: 0x13,
} as const;

/** A run of glyphs the printer drew: its font and colour number, its first glyph's place, its table entry (its depth among the 2D), its text. */
export interface PrintRun {
  readonly font: number;
  readonly colour: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly text: string;
}

/** An entry of the mode menu as this visit lists it: its name, mode, whether it needs both pads, colour, and whether it is newly earned. */
export interface MenuItem {
  readonly name: string;
  readonly mode: number;
  readonly twoPads: boolean;
  readonly colour: number;
  readonly fresh: boolean;
}

/** One of Arcade's ten stage times: its frames, and who cleared it (roster id, costume, side). */
export interface StageTime {
  frames: number;
  roster: number;
  costume: number;
  side: number;
}

/** A cell of the character select's grid: its neighbours (none 0x16), whether it shows, its roster id (none -1), its place. */
export interface SelectCell {
  up: number;
  down: number;
  left: number;
  right: number;
  shows: number;
  roster: number;
  x: number;
  y: number;
}

/**
 * A side of the character select: its state, its cursor's cell, its cursor's and name's kinds,
 * whether its portrait faces the other way, the character its portrait shows, the one its cursor
 * is on, the frames it waits once chosen, its portrait's fade, its last choice, and its choice as
 * the two are kept apart (with whether it counts as chosen and as a human's).
 */
export interface SelectSide {
  state: number;
  cell: number;
  cursor: number;
  nameKind: number;
  mirrored: number;
  shownRoster: number;
  shownCostume: number;
  roster: number;
  costume: number;
  wait: number;
  fade: number;
  lastRoster: number;
  lastCostume: number;
  readonly apart: { roster: number; costume: number; chosen: number; human: number };
}

/** A sparkle rising over a portrait: whether it is on, its phase, its place, the line it rose from, the field it was born, its level and how fast that falls. */
export interface Sparkle {
  on: number;
  phase: number;
  x: number;
  y: number;
  from: number;
  born: number;
  level: number;
  fade: number;
}

/**
 * A side of the versus select: its state, its cursor's column and row, its cursor's, name's and
 * slot's kinds, the characters it may still choose (roster bits), how many it chooses and has
 * chosen, its choices (codes, 0x58 none), its handicap and its gauge's place and where that is
 * going, its last choice, its choice as two are kept apart (with whether it counts as chosen and as
 * a human's), and the bar under its name (its left, line and width, 0 none, and costume).
 */
export interface VsSelectSide {
  state: number;
  column: number;
  row: number;
  cursor: number;
  nameKind: number;
  slotKind: number;
  pool: number;
  teamSize: number;
  count: number;
  readonly chosen: number[];
  handicap: number;
  gaugeTarget: number;
  gaugeX: number;
  last: number;
  readonly apart: { roster: number; costume: number; chosen: number; human: number };
  readonly bar: { x: number; y: number; width: number; costume: number };
}

/** One of Arcade's opponents: its roster id and costume, and the round it comes in. */
export interface Opponent {
  roster: number;
  costume: number;
  round: number;
}

/** A thing the versus screen draws, as the mode lays it out. */
export type VersusRecord =
  | { readonly kind: 'background'; readonly picture: number }
  | { readonly kind: 'band'; readonly colour: number; readonly width: number; readonly y: number }
  | { readonly kind: 'portrait'; readonly side: number; readonly code: number; readonly colour: number; readonly flipped: number; readonly x: number; readonly y: number; readonly slideX: number; readonly slideY: number }
  | { readonly kind: 'text'; readonly text: string; readonly colour: number; readonly font: number; readonly x: number; readonly y: number }
  | { readonly kind: 'name'; readonly text: string; readonly colour: number; readonly font: number; readonly x: number; readonly y: number; readonly slideX: number; readonly slideY: number };

/** A fade over the picture from a table entry on: below 0x100 toward black (0 black), above toward white (0x1ff white). */
export interface Fade {
  readonly layer: number;
  readonly level: number;
}

/** The pads beyond what the fight reads: each pad's mapping from its raw bits, the buttons repeating while held, and each button's hold count. */
export interface GamePads {
  readonly maps: number[][];
  readonly repeats: number[];
  readonly counts: number[][];
}

/**
 * The records' name entry: the name as it stands (three letters, the cursor's letter showing at
 * its place), the cursor's place (3 once the name is ended), the letter it is on (of the 40),
 * the holder's character and pad, and whether a letter was taken and the letter moved this frame.
 */
export interface NameEntry {
  name: string;
  place: number;
  letter: number;
  roster: number;
  pad: number;
  took: number;
  moved: number;
}

/** What the screen shows from a vertical blank on while a movie plays: a frame of a movie file (by its number from 1) with its caption (-1 none), or none (frame 0: black, or white). */
export interface MovieShow {
  readonly at: number;
  readonly file: number;
  readonly frame: number;
  readonly white: boolean;
  readonly caption: number;
}

/** What the credits drew a frame: a line of type (its left, top, size, brightness), a band of light behind a line (its place and colour), the namco mark at a brightness. */
export type CreditsDraw =
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly small: boolean; readonly brightness: number; readonly text: string }
  | { readonly kind: 'band'; readonly x0: number; readonly y: number; readonly x1: number; readonly x2: number; readonly width: number; readonly red: number; readonly green: number; readonly blue: number }
  | { readonly kind: 'mark'; readonly brightness: number };

/**
 * The credits' roll (`credits.ts`): its state, the roll's place (`scroll`, the lines climbing
 * from the foot) and its top line, the fades' base, the band's colour, the line being placed (its
 * left edge, top, type's left and right, the offset between, its width), a toggle each frame, the
 * lines' brightness, the line drawn and its place, the band's fade and the end's flare, hold and
 * phase, the frames counted, whether a button cut it short, and the kind the last line read as;
 * and this frame's draws.
 */
export interface CreditsState {
  state: number;
  scroll: number;
  line: number;
  fadeBase: number;
  red: number;
  green: number;
  blue: number;
  x0: number;
  y: number;
  x1: number;
  x2: number;
  offset: number;
  width: number;
  toggle: number;
  brightness: number;
  cursor: number;
  lineY: number;
  widthCopy: number;
  fade: number;
  flare: number;
  hold: number;
  count: number;
  pressed: number;
  end: number;
  kind: number;
  readonly drawn: CreditsDraw[];
}

/**
 * The movie player's records: its state (1 waiting to start, 2 playing, 3 at its last frame, 5
 * ending, 0 done), the start's countdown, the last frame taken, whether the disc's lid opened, whether
 * the stream ended; from the record's flags whether it loops, its captions, how it ends, whether
 * the drive reads on through its file, whether its end clears to white; the screen clears left,
 * the result (0 playing, 1 played through, -2 stopped by start, -1 the stream failed), the captions'
 * strip; the movie, its file, its frames to play; the stream (when the drive began reading, the
 * frames taken since, the frame taken to show next); and what this frame showed when.
 */
export interface MovieState {
  state: number;
  countdown: number;
  last: number;
  lidOpen: number;
  ended: number;
  loops: number;
  captions: number;
  endKind: number;
  readOn: number;
  clears: number;
  white: number;
  result: number;
  strip: number;
  movie: number;
  file: number;
  frames: number;
  readonly stream: { start: number; taken: number; pending: number };
  readonly shows: MovieShow[];
  /** The endings' captions: the one shown (-1 none) and the set's first cue. */
  caption: number;
  captionCue: number;
}

export interface GameState {
  readonly world: FightState;
  /** The scene playing, and its state. */
  scene: number;
  step: number;
  /** The scene the logo scene goes on to, and the scene it came from. */
  next: number;
  last: number;
  /** The scene and state the loader goes on to once its files are read, the files queued and the one it reads next. */
  readonly loader: { scene: number; step: number; queued: number; next: number };
  /** Whether the next overlay is the attract's, the last one's, which of the logo scene's loads are done, and the memory card read. */
  attractOverlay: number;
  lastAttractOverlay: number;
  loaded: number;
  cardRead: number;
  /** The attract cycle: its step (0 to 3), the intro shown, the intros earned. */
  readonly attract: { step: number; intro: number; intros: number };
  /** A count the scenes keep: the logo's fade, the title's holds, the menu's idle frames. */
  count: number;
  /** Whether the picture is held as last drawn. */
  held: number;
  /** The second random generator, stepped every field. */
  noise: number;
  /** The mode overlay in memory (none 0xff). */
  modeOverlay: number;
  readonly pads: GamePads;
  /** Whether each pad's motor runs (the option, or off), for the presentation's vibration. */
  readonly motors: number[];
  /** What the printer drew this field, in order. */
  readonly printed: PrintRun[];
  /** The fades drawn this field. */
  readonly fades: Fade[];
  /** The logo scene's picture: what it shows (0 fading in, 1 shown, 2 black, 3 nothing) and the fade's level. */
  readonly logo: { shows: number; level: number };
  /**
   * The title: what it shows (0 black, 1 and 7 the movie, 2 the title with its start line and
   * lines, 5 the picture alone, 6 its darker picture, 8 black), the movie's state and which movie.
   */
  readonly title: { shows: number; movie: number; movieKind: number };
  /** The vertical blanks counted (every field), and the frame's clock: where its code is in fields as its waits move it on, and the blank the next frame starts at. */
  vblanks: number;
  readonly clock: { now: number; next: number };
  /** The movie player (`movie.ts`). */
  readonly movie: MovieState;
  /**
   * The credits after an ending, and the Theater's record: whether it is the Theater mode (1) or an
   * ending (0), its movie, and whether the movie plays on within the scene's frame (its waits
   * reading the pads, `theater.ts`).
   */
  readonly credits: CreditsState;
  readonly theater: { mode: number; movie: number; playing: number };
  /** The options as set (`PowerOn`'s), each pad's key configuration, and how far Tekken Ball and the Theater are earned. */
  readonly options: {
    difficulty: number;
    rounds: number;
    roundTime: number;
    alwaysChip: number;
    continueChooses: number;
    readonly vibration: number[];
    readonly lastChoices: number[];
    keepChoices: number;
    modeSetting: number;
    readonly keys: number[][];
  };
  readonly earned: { ball: number; theater: number };
  /**
   * The mode menu: its entries this visit and their count, the one picked (kept between visits),
   * whether to open on the options, the list's scroll easing to its place, the bar's brightness,
   * whether an entry was chosen and which pads chose it.
   */
  readonly menu: { items: MenuItem[]; count: number; picked: number; toOptions: number; scroll: number; bar: number; chosen: number; choosers: number };
  /** Each side's choice for the match: its roster id and costume, whether the computer plays it, and whether it is chosen. */
  readonly entrants: { readonly roster: number[]; readonly costume: number[]; readonly computer: number[]; readonly chosen: number[] };
  /**
   * The mode's run beyond what the fight keeps: whether challengers may join and choose again, what
   * skips the character select, whether a continue chooses again, start held with both shoulders,
   * whether the mode's setup ran and its continue is up, the scene and state a versus screen goes
   * on to, the mode overlay asked for, the side a newcomer plays,
   * versus's matches, the run's last and total time, Arcade's stage times and ending, versus's stage
   * memory (the code it keeps and each side's), each side's team counts, the match's stage and song,
   * and Arcade's opponents.
   */
  /**
   * What the game keeps between plays: the characters earned (a bit per roster id), those with a
   * third costume, whether Arcade draws one more; per character (an added one last) its Arcade
   * plays, versus wins, versus losses and versus draws; the endings seen (by costume); the newest
   * character earned (0x16 none); the plays since the last unlock, the schedule's step and whether
   * it has started; whether they changed since last saved; Arcade's best time per character and
   * survival's ten best, with the row of each a run just set (-1 none); the ranking the records
   * screen shows next, the stage it circles next, whether a new record waits for its name (bit 0
   * a time, bit 1 survival's) and the side that set it and its character; which of the demo's
   * characters fought it last.
   */
  readonly records: {
    earnedRoster: number;
    extraCostumes: number;
    extraDrawn: number;
    readonly plays: number[][];
    readonly endings: number[];
    readonly times: { frames: number; initials: string }[];
    timeSet: number;
    readonly survivors: { roster: number; wins: number; initials: string }[];
    survivorSet: number;
    list: number;
    stageTurn: number;
    naming: number;
    readonly holder: { side: number; roster: number };
    demoTurn: number;
    newest: number;
    playsSince: number;
    scheduleStep: number;
    scheduleStarted: number;
    changed: number;
  };
  /**
   * The character select: the mode it chooses for, whether a second row shows, its frame count,
   * the fields the band below redraws, the frames the arrows pulse, the countdown and its frames a
   * count, the characters shown (bits) and their count, the grid, the two sides, the sparkles.
   */
  readonly select: {
    mode: number;
    twoRows: number;
    frames: number;
    refresh: number;
    arrivals: number;
    countdown: number;
    perCount: number;
    shown: number;
    count: number;
    readonly cells: SelectCell[];
    readonly sides: SelectSide[];
    readonly sparkles: Sparkle[];
  };
  /** The portrait each side's last shown character has, for the versus screen, and the versus screen's background last loaded. */
  readonly versusPortraits: number[];
  versusBackground: number;
  /** The versus screen: the frames its slide has to go, and what it draws. */
  readonly versus: { countdown: number; readonly records: VersusRecord[] };
  /**
   * The versus select: the mode it chooses for, the frames no pad has been touched, whether it is
   * fading in and how far, the strip's and the tournament line's scroll, the two sides.
   */
  readonly vsSelect: {
    mode: number;
    idle: number;
    fading: number;
    fade: number;
    strip: number;
    line: number;
    readonly sides: VsSelectSide[];
  };
  /**
   * The records screen: what it draws (0 black, 1 the title's bar, 2 with the list, 3 the name
   * entry, 4 its name ended), the list's place down and where it is going, the frames a page has
   * stood and how long it stands (the frames the name entry has left), how far the bars have grown
   * (of 64), the rows' count and order (roster ids, or survival's rows), each character's share of
   * the plays (in tenths of a percent) and the largest, the row lit (0xffff none) and its place
   * on its page, the page's first row and the first with its bars grown; the name entry; the
   * camera circling the stage (its angle round, and its view: pitch, yaw, roll and eye).
   */
  readonly recordsScreen: {
    draws: number;
    place: number;
    going: number;
    frames: number;
    stay: number;
    grown: number;
    count: number;
    readonly order: number[];
    readonly shares: number[];
    largest: number;
    lit: number;
    litPlace: number;
    pageFirst: number;
    barsFrom: number;
    readonly naming: NameEntry;
    orbit: number;
    readonly camera: { pitch: number; yaw: number; roll: number; readonly eye: number[] };
  };
  /**
   * The attract overlay (scene 6): what it draws (as the title's `shows`), the intro's step, its
   * frame, the fade to white (whether it runs, its level, its step), whether the intro's camera
   * has handed back, the script's next event, and each side's record: what it is doing (1 a move,
   * 2 to 6 changing model), its pack, its move, the move's last frame, its frame. (The game also
   * keeps a bit that holds the intro's frame still; nothing ever sets it.)
   */
  readonly attractScreen: {
    draw: number;
    step: number;
    frame: number;
    fading: number;
    fade: number;
    fadeStep: number;
    cameraDone: number;
    event: number;
    readonly sides: { doing: number; pack: number; move: number; last: number; frame: number }[];
  };
  /**
   * Ogre's change into True Ogre (`ogre-change.ts`): its phase (0 its camera set up, 1 its script,
   * 2 the white held), its frames, the script's next event, each side's record (whether it plays,
   * its move, the move's last frame, its frame), the fade to white (whether it runs, its level,
   * its step), whether its camera's script is over, whether the stage's scenery is no longer
   * drawn, and what the field shows (`OgreChangeShows`).
   */
  readonly ogreChange: {
    phase: number;
    time: number;
    event: number;
    readonly sides: { active: number; move: number; last: number; frame: number }[];
    fading: number;
    fade: number;
    fadeStep: number;
    cameraDone: number;
    sceneryOff: number;
    shows: number;
  };
  /** Whether the fight was drawn this field (the picture holds otherwise). */
  drewFight: number;
  /** Set on a field the game's code ran: a frame started, or a frame went on through a movie's waits. */
  codeRan: number;
  /** Set on a field the game saves its progress (`save.ts`), where the console writes its memory card. */
  saving: number;
  readonly run: {
    challengers: number;
    challengerChooses: number;
    skipsSelect: number;
    continueChooses: number;
    modeSetting: number;
    shoulders: number;
    started: number;
    readonly after: { scene: number; step: number };
    overlay: number;
    newcomer: number;
    versusMatches: number;
    lastTime: number;
    readonly stageTimes: StageTime[];
    readonly ending: { side: number; code: number };
    readonly versusStage: { code: number; first: number; second: number };
    /** Versus mode's wins by side and its draws, since it was chosen. */
    readonly versusRecord: { readonly wins: number[]; draws: number };
    /** The stage and song chosen for the match; Arcade's ten opponents. */
    stageChosen: number;
    songChosen: number;
    readonly opponents: Opponent[];
  };
}

const PAD_BITS = 16;
const identity = (): number[] => Array.from({ length: PAD_BITS }, (_, bit) => 1 << bit);

/** The game as power-on leaves it, before the boot. */
export function blankGameState(): GameState {
  return {
    world: blankFightState(),
    scene: Scene.BOOT,
    step: 0,
    next: 0,
    last: 0,
    loader: { scene: 0, step: 0, queued: 0, next: 0 },
    attractOverlay: 0,
    lastAttractOverlay: 0,
    loaded: 0,
    cardRead: 0,
    attract: { step: 0, intro: 0, intros: 0 },
    count: 0,
    held: 0,
    noise: 0,
    modeOverlay: 0,
    pads: { maps: [identity(), identity()], repeats: [0, 0], counts: [new Array<number>(PAD_BITS).fill(0), new Array<number>(PAD_BITS).fill(0)] },
    motors: [0, 0],
    printed: [],
    fades: [],
    logo: { shows: 3, level: 0 },
    title: { shows: 0, movie: 0, movieKind: 0 },
    vblanks: 0,
    clock: { now: 0, next: 0 },
    movie: {
      state: 0,
      countdown: 0,
      last: 0,
      lidOpen: 0,
      ended: 0,
      loops: 0,
      captions: 0,
      endKind: 0,
      readOn: 0,
      clears: 0,
      white: 0,
      result: 0,
      strip: 0,
      movie: 0,
      file: 0,
      frames: 0,
      stream: { start: 0, taken: 0, pending: 0 },
      shows: [],
      caption: -1,
      captionCue: -1,
    },
    credits: {
      state: 0,
      scroll: 0,
      line: 0,
      fadeBase: 0,
      red: 0,
      green: 0,
      blue: 0,
      x0: 0,
      y: 0,
      x1: 0,
      x2: 0,
      offset: 0,
      width: 0,
      toggle: 0,
      brightness: 0,
      cursor: 0,
      lineY: 0,
      widthCopy: 0,
      fade: 0,
      flare: 0,
      hold: 0,
      count: 0,
      pressed: 0,
      end: 0,
      kind: 0,
      drawn: [],
    },
    theater: { mode: 0, movie: 0, playing: 0 },
    options: { difficulty: 0, rounds: 0, roundTime: 0, alwaysChip: 0, continueChooses: 0, vibration: [0, 0], lastChoices: [0, 0], keepChoices: 0, modeSetting: 0, keys: [new Array<number>(8).fill(0), new Array<number>(8).fill(0)] },
    earned: { ball: 0, theater: 0 },
    menu: { items: [], count: 0, picked: 0, toOptions: 0, scroll: 0, bar: 0, chosen: 0, choosers: 0 },
    entrants: { roster: [0, 0], costume: [0, 0], computer: [0, 0], chosen: [0, 0] },
    records: {
      earnedRoster: 0,
      extraCostumes: 0,
      extraDrawn: 0,
      plays: Array.from({ length: 23 }, () => [0, 0, 0, 0]),
      endings: [0, 0],
      times: Array.from({ length: 22 }, () => ({ frames: 0, initials: '' })),
      timeSet: -1,
      survivors: Array.from({ length: 10 }, () => ({ roster: 0, wins: 0, initials: '' })),
      survivorSet: -1,
      list: 0,
      stageTurn: 0,
      naming: 0,
      holder: { side: 0, roster: 0 },
      demoTurn: 0,
      newest: 0,
      playsSince: 0,
      scheduleStep: 0,
      scheduleStarted: 0,
      changed: 0,
    },
    select: {
      mode: 0,
      twoRows: 0,
      frames: 0,
      refresh: 0,
      arrivals: 0,
      countdown: 0,
      perCount: 0,
      shown: 0,
      count: 0,
      cells: Array.from({ length: 22 }, () => ({ up: 0, down: 0, left: 0, right: 0, shows: 0, roster: 0, x: 0, y: 0 })),
      sides: Array.from({ length: 2 }, () => ({
        state: 0,
        cell: 0,
        cursor: 0,
        nameKind: 0,
        mirrored: 0,
        shownRoster: 0,
        shownCostume: 0,
        roster: 0,
        costume: 0,
        wait: 0,
        fade: 0,
        lastRoster: 0,
        lastCostume: 0,
        apart: { roster: 0, costume: 0, chosen: 0, human: 0 },
      })),
      sparkles: Array.from({ length: 64 }, () => ({ on: 0, phase: 0, x: 0, y: 0, from: 0, born: 0, level: 0, fade: 0 })),
    },
    versusPortraits: [0, 0],
    versusBackground: 0,
    versus: { countdown: 0, records: [] },
    vsSelect: {
      mode: 0,
      idle: 0,
      fading: 0,
      fade: 0,
      strip: 0,
      line: 0,
      sides: Array.from({ length: 2 }, () => ({
        state: 0,
        column: 0,
        row: 0,
        cursor: 0,
        nameKind: 0,
        slotKind: 0,
        pool: 0,
        teamSize: 0,
        count: 0,
        chosen: new Array<number>(8).fill(0),
        handicap: 0,
        gaugeTarget: 0,
        gaugeX: 0,
        last: 0,
        apart: { roster: 0, costume: 0, chosen: 0, human: 0 },
        bar: { x: 0, y: 0, width: 0, costume: 0 },
      })),
    },
    recordsScreen: {
      draws: 0,
      place: 0,
      going: 0,
      frames: 0,
      stay: 0,
      grown: 0,
      count: 0,
      order: new Array<number>(22).fill(0),
      shares: new Array<number>(22).fill(0),
      largest: 0,
      lit: 0,
      litPlace: 0,
      pageFirst: 0,
      barsFrom: 0,
      naming: { name: '', place: 0, letter: 0, roster: 0, pad: 0, took: 0, moved: 0 },
      orbit: 0,
      camera: { pitch: 0, yaw: 0, roll: 0, eye: [0, 0, 0] },
    },
    attractScreen: {
      draw: 0,
      step: 0,
      frame: 0,
      fading: 0,
      fade: 0,
      fadeStep: 0,
      cameraDone: 0,
      event: 0,
      sides: [0, 1].map(() => ({ doing: 0, pack: 0, move: 0, last: 0, frame: 0 })),
    },
    ogreChange: {
      phase: 0,
      time: 0,
      event: 0,
      sides: [0, 1].map(() => ({ active: 0, move: 0, last: 0, frame: 0 })),
      fading: 0,
      fade: 0,
      fadeStep: 0,
      cameraDone: 0,
      sceneryOff: 0,
      shows: 0,
    },
    drewFight: 0,
    codeRan: 0,
    saving: 0,
    run: {
      challengers: 0,
      challengerChooses: 0,
      skipsSelect: 0,
      continueChooses: 0,
      modeSetting: 0,
      shoulders: 0,
      started: 0,
      after: { scene: 0, step: 0 },
      overlay: 0,
      newcomer: 0,
      versusMatches: 0,
      lastTime: 0,
      stageTimes: Array.from({ length: 10 }, () => ({ frames: 0, roster: 0, costume: 0, side: 0 })),
      ending: { side: 0, code: 0 },
      versusStage: { code: 0, first: 0, second: 0 },
      versusRecord: { wins: [0, 0], draws: 0 },
      stageChosen: 0,
      songChosen: 0,
      opponents: Array.from({ length: 10 }, () => ({ roster: 0, costume: 0, round: 0 })),
    },
  };
}
