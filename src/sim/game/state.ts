/**
 * The whole game's state, a field at a time: the scene playing and its state, what the scenes
 * share (the attract cycle, the count most of them keep, the picture held), the pads' mapping and
 * repeats, the second random generator, and what the printer drew this field. The fight's state is
 * the game's world: the counters, pads, mode, entrants and options it holds are the game's own,
 * and the scenes read and write them there.
 */
import { blankFightState } from '../fight/blank.ts';
import type { FightState } from '../fight/state.ts';
import type { Progress } from './save.ts';

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
  TEAM_RESULTS: 0xc,
  TIME_RESULTS: 0xd,
  SURVIVAL_RESULTS: 0xe,
  FORCE_RESULTS: 0xf,
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
 * A side of the versus select: its state, whether a kick chose its team's size, its cursor's column and row, its cursor's, name's and
 * slot's kinds, the characters it may still choose (roster bits), how many it chooses and has
 * chosen, its choices (codes, 0x58 none), its handicap and its gauge's place and where that is
 * going, its last choice, its choice as two are kept apart (with whether it counts as chosen and as
 * a human's), and the bar under its name (its left, line and width, 0 none, and costume).
 */
export interface VsSelectSide {
  state: number;
  kick: number;
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
  | { readonly kind: 'name'; readonly text: string; readonly colour: number; readonly font: number; readonly x: number; readonly y: number; readonly slideX: number; readonly slideY: number }
  /** A team member's icon (dimmed once beaten), sliding in; the box behind a team's icons; the light behind the teams' rows. */
  | { readonly kind: 'teamIcon'; readonly code: number; readonly beaten: boolean; readonly x: number; readonly y: number; readonly slideX: number; readonly slideY: number }
  | { readonly kind: 'teamBox'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'teamLight' };

/**
 * What a scene drew besides the printer's runs (the Options and the Theater's menu), each in its
 * table entry (`layer`, 0 drawn first) and after the runs printed before it (`at`, their count
 * then): within an entry what was drawn later lies under what was drawn before. A rectangle of
 * colour (0xBBGGRR); a rectangle shaded from its corners' colours (top left, top right, bottom
 * left, bottom right); a pad's button (by its bit: the four buttons the game shows as pictures);
 * the Options' mode label (in its colour or greyed), pad picture, STEP arrow (in a printer
 * colour) and a button box's pointer (a line from its start to a point on the pad, with a sliver
 * of a triangle along it); the Theater's thumbnail (by its picture), its film frame, and its other
 * pictures; Practice's hit markers and input icons.
 */
export type SceneDraw =
  | { readonly kind: 'tile'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly colour: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'shade'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly colours: readonly [number, number, number, number]; readonly layer: number; readonly at: number }
  | { readonly kind: 'button'; readonly bit: number; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'label'; readonly label: number; readonly grey: boolean; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'pad'; readonly x: number; readonly y: number; readonly dualShock: boolean; readonly layer: number; readonly at: number }
  | { readonly kind: 'arrow'; readonly x: number; readonly y: number; readonly down: boolean; readonly colour: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'pointer'; readonly x: number; readonly y: number; readonly toX: number; readonly toY: number; readonly colour: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'thumb'; readonly picture: number; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'film'; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'picture'; readonly picture: 'cover' | 'caption' | 'disc'; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  /** Practice's hit marker (0 HIGH, 1 MID, 2 LOW, 3 the ! of an unblockable) about where a hit landed; an input display's icon (a direction, or a set of buttons), lit (0) or dim (3; a set's base 1 light, 0 dark). */
  | { readonly kind: 'marker'; readonly marker: number; readonly x: number; readonly y: number; readonly layer: number; readonly at: number }
  | { readonly kind: 'input'; readonly pad: number; readonly lit: number; readonly x: number; readonly y: number; readonly layer: number; readonly at: number };

/**
 * A side of the key configuration, its pad's: the item its cursor is on (0 the setting, 1
 * vibration, 2 the default, 3 the way out), whether a button was newly pressed on its pad since
 * the page opened, whether it is busy this frame (a box open or moving, a button held, a press
 * taken), its pad's type (9 a DualShock), the buttons held and repeating that the setting reads,
 * the values its keys use (bits), and each button's box: its state (0 closed, 1 opening, 2 open,
 * 3 closing) and how far open (of 8).
 */
export interface KeySide {
  cursor: number;
  active: number;
  busy: number;
  type: number;
  held: number;
  repeats: number;
  used: number;
  readonly boxes: { state: number; grow: number }[];
}

/**
 * Practice's record of the damage a fighter took: its total, the combo's damage (and as shown),
 * the last hit's damage before and after scaling, how long the combo's count shows, the frames
 * since a hit, the combo's hits (new this frame, ended this frame, last frame's; for the combo
 * replay, last frame's and ended), whether the last hit was a counter hit or clean, the throw
 * hold seen, the hits shown, and whether the attacker's move and the one before keep a combo going.
 */
export interface DamageRecord {
  total: number;
  combo: number;
  comboShown: number;
  raw: number;
  dealt: number;
  timer: number;
  frames: number;
  hits: number;
  newHits: number;
  endedHits: number;
  lastHits: number;
  hitsSeen: number;
  hitsEnded: number;
  counter: number;
  clean: number;
  hold: number;
  shownHits: number;
  flag: number;
  lastFlag: number;
}

/**
 * Practice (`practice.ts`): the human's pad as read this frame (held, newly pressed, repeating,
 * and through its mapping held and pressed), the guide's presses, the frames since the last combo
 * replay and the combo's length, each moveset slot's damage record, the hit markers (level,
 * frames left, screen place) and the newest, whether MODE SELECT shows, the frames the start
 * ignores the pad, the mode (0 1P FREESTYLE, 1 VS CPU, 2 COMBO TRAINING) and each one's cursor,
 * the combo player and type, the training dummy, the computer's difficulty and stage, how the
 * partner is played (0 a pad, 1 the dummy, 2 the computer), the combo replay, the session's
 * step, the options (hit analysis, attack data, counter attacks), the sides, whether the session
 * runs, whether each moveset slot can act, the pause now and last frame, the command lists shown,
 * the input display and its guide and look and wait, whether line 0 reads CANCEL, a playback
 * asked again, the frames the menu waits, whether each moveset slot is attacking, whether the
 * pause keys the voices off; and the input recorder: its 50 entries, the entry played and its
 * copy running down, and per side the newest entry and its idle count.
 */
export interface PracticeState {
  readonly pad: { raw: number; fresh: number; repeats: number; held: number; pressed: number };
  guidePressed: number;
  guideLast: number;
  sinceReplay: number;
  sinceCombo: number;
  readonly records: DamageRecord[];
  readonly markers: { level: number; timer: number; x: number; y: number }[];
  markerAt: number;
  modeSelect: number;
  startWait: number;
  mode: number;
  readonly cursor: number[];
  player: number;
  comboType: number;
  dummy: number;
  cpuDifficulty: number;
  cpuLevel: number;
  partnerKind: number;
  comboReplay: number;
  step: number;
  hitAnalysis: number;
  humanSide: number;
  partnerSide: number;
  session: number;
  readonly canAct: number[];
  paused: number;
  wasPaused: number;
  attackData: number;
  counterAttacks: number;
  commandList: number;
  inputShown: number;
  guide: number;
  look: number;
  lookWait: number;
  cancelLabel: number;
  playAgain: number;
  menuWait: number;
  readonly attacking: number[];
  keyOffOnPause: number;
  readonly recorder: { readonly entries: number[]; playIndex: number; cursor: number; readonly last: number[]; readonly idle: number[] };
}

const blankDamage = (): DamageRecord => ({ total: 0, combo: 0, comboShown: 0, raw: 0, dealt: 0, timer: 0, frames: 0, hits: 0, newHits: 0, endedHits: 0, lastHits: 0, hitsSeen: 0, hitsEnded: 0, counter: 0, clean: 0, hold: 0, shownHits: 0, flag: 0, lastFlag: 0 });

/** Practice as its overlay loads. */
export function blankPractice(): PracticeState {
  return {
    pad: { raw: 0, fresh: 0, repeats: 0, held: 0, pressed: 0 },
    guidePressed: 0,
    guideLast: 0,
    sinceReplay: 0,
    sinceCombo: 0,
    records: [blankDamage(), blankDamage()],
    markers: Array.from({ length: 4 }, () => ({ level: 0, timer: 0, x: 0, y: 0 })),
    markerAt: 0,
    modeSelect: 0,
    startWait: 0,
    mode: 0,
    cursor: [0, 0, 0],
    player: 0,
    comboType: 0,
    dummy: 0,
    cpuDifficulty: 0,
    cpuLevel: 0,
    partnerKind: 0,
    comboReplay: 0,
    step: 0,
    hitAnalysis: 0,
    humanSide: 0,
    partnerSide: 0,
    session: 0,
    canAct: [0, 0],
    paused: 0,
    wasPaused: 0,
    attackData: 0,
    counterAttacks: 0,
    commandList: 0,
    inputShown: 0,
    guide: 0,
    look: 0,
    lookWait: 0,
    cancelLabel: 0,
    playAgain: 0,
    menuWait: 0,
    attacking: [0, 0],
    keyOffOnPause: 0,
    recorder: { entries: new Array<number>(50).fill(0), playIndex: 0, cursor: 0, last: [0, 0], idle: [0, 0] },
  };
}

/** A motor's channel of a pad's vibration: the pattern it plays, its step (-1 none) and the fields into it, whether it played this field and what. */
export interface MotorTrack {
  pattern: number;
  step: number;
  count: number;
  active: number;
  value: number;
}

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
  /** The mode overlay in memory (none 0xff). */
  modeOverlay: number;
  readonly pads: GamePads;
  /** Whether each pad's motor runs (the option, or off). */
  readonly motors: number[];
  /**
   * The pads' vibration (`rumble.ts`): each pad's small and large motor on each of four channels,
   * whether every channel is to be emptied at the next field, the fields counted (the small
   * motor's turning), and what each pad feels this field (its small motor on or off, its large
   * motor's strength of 255).
   */
  readonly rumble: { readonly tracks: MotorTrack[]; empty: number; clock: number; readonly out: number[][] };
  /** What the printer drew this field, in order, and what else the scene drew among it. */
  readonly printed: PrintRun[];
  readonly drawn: SceneDraw[];
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
  readonly theater: {
    mode: number;
    movie: number;
    playing: number;
    /** The menu's: the song chosen (its code: twice the song, one more for the arcade's), the cursor in the page's list, its first row (or entry) shown, what has the focus (0 the list, 1 EXIT, 2 MUSIC or THEATER, 4 BGM SELECT), whether every entry is open, the frames no button is held. */
    song: number;
    cursor: number;
    scroll: number;
    focus: number;
    allSeen: number;
    idle: number;
  };
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
    /** The music's set (0 the arrangement's, 1 the arcade's, 2 silent in the matches' scenes) and whether it plays in stereo. */
    musicSet: number;
    stereo: number;
    /** The hidden switch the key configuration's L2, R2 and select turn (the Options' titles in another colour). */
    otherTitle: number;
    /** Whether the progress is saved on its own as records change, and the display's place (its steps across and down). */
    autoSave: number;
    readonly display: { x: number; y: number };
  };
  readonly earned: { ball: number; theater: number };
  /** The progress as last saved, which a load brings back (null: none saved), as the memory card holds it. */
  kept: Progress | null;
  practice: PracticeState;
  /**
   * The Options (scene 5): the page shown, each page's cursor and screen (a memory card screen, or
   * the records' first frame), the modes' labels the box lists, the memory card's answer, the key
   * configuration's two sides, and the records' lists (the one shown, all plays, each list's first
   * row shown, its rows and their order).
   */
  readonly optionsScreen: {
    page: number;
    readonly pages: { cursor: number; sub: number }[];
    readonly labels: number[];
    card: number;
    readonly sides: KeySide[];
    readonly records: { list: number; total: number; readonly lists: { first: number; count: number; readonly order: number[] }[] };
  };
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
   * characters fought it last; Tekken Force's best score and the keys held.
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
    forceBest: number;
    forceKeys: number;
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
   * The results after a run: its frames, its fade, how many rows show and how far the next has
   * counted up (of 16), a wait, whether the total shows, the total, whether it is a new record, the
   * side and character that ran, and the line said after the runner's own (its step and wait);
   * for Survival, the characters beaten (the most beaten first), how many, the run's rank, and its
   * backdrop's scrolls (the game's name's and the tournament line's); for Team Battle, each bout's
   * member of each side, each side's members left and beaten so far as shown; for Tekken Force,
   * the fields shown, the bosses' row's own count, the FORCE count's state (0 waiting, 1 counting,
   * 2 done) and its count, and the portrait's light colour and whether it is flipped.
   */
  readonly results: {
    readonly boutMembers: number[][];
    readonly left: number[];
    readonly beatenSoFar: number[];
    readonly beaten: number[];
    beatenCount: number;
    rank: number;
    strip: number;
    scroll: number;
    frames: number;
    fade: number;
    shown: number;
    counting: number;
    wait: number;
    showTotal: number;
    total: number;
    newRecord: number;
    side: number;
    code: number;
    line: number;
    lineWait: number;
    readonly force: { shown: number; bosses: number; countState: number; count: number; colour: number; flipped: number };
  };
  /**
   * The versus select: the mode it chooses for, the frames no pad has been touched, whether it is
   * fading in and how far, the strip's and the tournament line's scroll, the two sides; and Tekken
   * Ball's ball being chosen: where it is across and where it slides to, which way it last went
   * (-1 left, 1 right), its turns, and whether the arrows beside it show this field.
   */
  readonly vsSelect: {
    mode: number;
    idle: number;
    fading: number;
    fade: number;
    strip: number;
    line: number;
    readonly sides: VsSelectSide[];
    readonly ball: { x: number; target: number; direction: number; yaw: number; pitch: number; roll: number; arrows: number };
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
    /** Team Battle: each bout's winner (1 or 2, 3 a draw), the bout under way, and how often each character was drawn into a team (the teams are the match's). */
    readonly team: { readonly bouts: number[]; bout: number; readonly uses: number[] };
    /** Survival's next opponent (its code), its last four opponents (0x16 none) and where the next goes among them, and how often each character was beaten. */
    readonly survival: { opponent: number; recentAt: number; readonly recent: number[]; readonly beaten: number[] };
    /** Tekken Ball: who chooses the ball (0 nobody yet, 1 << side as that side starts, 3 once the choice runs), and how often each character was drawn as the computer's opponent. */
    readonly ball: { choosing: number; readonly met: number[] };
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
    modeOverlay: 0,
    pads: { maps: [identity(), identity()], repeats: [0, 0], counts: [new Array<number>(PAD_BITS).fill(0), new Array<number>(PAD_BITS).fill(0)] },
    motors: [0, 0],
    rumble: { tracks: Array.from({ length: 16 }, () => ({ pattern: 0, step: -1, count: 0, active: 0, value: 0 })), empty: 0, clock: 0, out: [[0, 0], [0, 0]] },
    printed: [],
    drawn: [],
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
    theater: { mode: 0, movie: 0, playing: 0, song: 0, cursor: 0, scroll: 0, focus: 0, allSeen: 0, idle: 0 },
    options: {
      difficulty: 0,
      rounds: 0,
      roundTime: 0,
      alwaysChip: 0,
      continueChooses: 0,
      vibration: [0, 0],
      lastChoices: [0, 0],
      keepChoices: 0,
      modeSetting: 0,
      keys: [new Array<number>(8).fill(0), new Array<number>(8).fill(0)],
      musicSet: 0,
      stereo: 0,
      otherTitle: 0,
      autoSave: 0,
      display: { x: 0, y: 0 },
    },
    earned: { ball: 0, theater: 0 },
    kept: null,
    practice: blankPractice(),
    optionsScreen: {
      page: 0,
      pages: Array.from({ length: 6 }, () => ({ cursor: 0, sub: 0 })),
      labels: [],
      card: 0,
      sides: [0, 1].map(() => ({ cursor: 0, active: 0, busy: 0, type: 0, held: 0, repeats: 0, used: 0, boxes: Array.from({ length: 8 }, () => ({ state: 0, grow: 0 })) })),
      records: { list: 0, total: 0, lists: Array.from({ length: 4 }, () => ({ first: 0, count: 0, order: new Array<number>(22).fill(0) })) },
    },
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
      forceBest: 0,
      forceKeys: 0,
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
    results: {
      boutMembers: [new Array<number>(16).fill(0), new Array<number>(16).fill(0)],
      left: [0, 0],
      beatenSoFar: [0, 0],
      beaten: new Array<number>(22).fill(0), beatenCount: 0, rank: 0, strip: 0, scroll: 0, frames: 0, fade: 0, shown: 0, counting: 0, wait: 0, showTotal: 0, total: 0, newRecord: 0, side: 0, code: 0, line: 0, lineWait: 0, force: { shown: 0, bosses: 0, countState: 0, count: 0, colour: 0, flipped: 0 } },
    vsSelect: {
      mode: 0,
      idle: 0,
      fading: 0,
      fade: 0,
      strip: 0,
      line: 0,
      sides: Array.from({ length: 2 }, () => ({
        state: 0,
        kick: 0,
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
      ball: { x: 0, target: 0, direction: 0, yaw: 0, pitch: 0, roll: 0, arrows: 0 },
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
      team: { bouts: new Array<number>(16).fill(0), bout: 0, uses: new Array<number>(22).fill(0) },
      survival: { opponent: 0, recentAt: 0, recent: [0, 0, 0, 0], beaten: new Array<number>(22).fill(0) },
      ball: { choosing: 0, met: new Array<number>(22).fill(0) },
      stageChosen: 0,
      songChosen: 0,
      opponents: Array.from({ length: 10 }, () => ({ roster: 0, costume: 0, round: 0 })),
    },
  };
}
