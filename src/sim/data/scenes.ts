/**
 * What the scenes read from the game's data: the values the game's state starts with at power-on
 * (the executable's initial data for the scenes' shared bytes), the title's lines and the mode
 * menu's entries.
 */

/** The scenes' shared state as the executable starts it. */
export interface PowerOn {
  /** The scene the logo scene goes on to, and the scene it came from. */
  readonly next: number;
  readonly last: number;
  /** Whether the next overlay is the attract's, and the last one's. */
  readonly attractOverlay: number;
  readonly lastAttractOverlay: number;
  /** The attract cycle's step, the intro it shows, and how many intros are earned. */
  readonly attractStep: number;
  readonly intro: number;
  readonly intros: number;
  /** The options: the computer's difficulty, rounds to win less one, the round's time setting, whether blocks always chip, whether a continue chooses again, the title's other picture, each pad's vibration, the characters last chosen per side (and whether they are kept), and a setting the modes copy. */
  readonly options: {
    readonly difficulty: number;
    readonly rounds: number;
    readonly roundTime: number;
    readonly alwaysChip: number;
    readonly continueChooses: number;
    readonly otherTitle: number;
    readonly vibration: readonly number[];
    readonly lastChoices: readonly number[];
    readonly keepChoices: number;
    readonly modeSetting: number;
  };
  /** Each pad's eight buttons' configuration (which of the key bits each takes). */
  readonly keys: readonly (readonly number[])[];
  /** How far Tekken Ball and the Theater are earned (3 shown and no longer new). */
  readonly ball: number;
  readonly theater: number;
  /** The mode menu's entry picked, and whether the menu opens on the options. */
  readonly picked: number;
  readonly toOptions: number;
  /** The characters earned (a bit per roster id) and those with a third costume. */
  readonly earnedRoster: number;
  readonly extraCostumes: number;
  /** The portrait each side's versus screen last had (0xff none), and its background. */
  readonly versusPortraits: readonly number[];
  readonly versusBackground: number;
  /** Whether Arcade draws from one more character. */
  readonly extraDrawn: number;
  /** Per character its Arcade plays, versus wins, versus losses and a fourth count; the endings seen (first costume, second); the newest character earned; the plays since the last unlock; the unlock schedule's step and whether it has started. */
  readonly plays: readonly (readonly number[])[];
  readonly endings: readonly number[];
  readonly newest: number;
  readonly playsSince: number;
  readonly scheduleStep: number;
  readonly scheduleStarted: number;
  /** Arcade's best time per character (frames, and the holder's initials), survival's ten best (the character, the wins, the initials), and the row of each just set (-1 none). */
  readonly times: readonly TimeRecord[];
  readonly timeSet: number;
  readonly survivors: readonly SurvivalRecord[];
  readonly survivorSet: number;
  /** The ranking the records screen shows next, the stage it circles next, whether a run's new record waits for its name (bit 0 a time, bit 1 survival's), and the side that set it and its character. */
  readonly list: number;
  readonly stageTurn: number;
  readonly naming: number;
  readonly holder: { readonly side: number; readonly roster: number };
  /** Which of the demo's characters fought it last. */
  readonly demoTurn: number;
}

/**
 * An attract intro: its script (each event its frame, what (0 or 1 a side's model, 2 or 3 a side's
 * move, 5 the fade to white, -1 the end) and three arguments), each pack's model pair in its archive
 * (-1 none), and the archive's member its two shadows start at.
 */
export interface IntroTables {
  readonly script: readonly (readonly [number, number, number, number, number])[];
  readonly pairs: readonly number[];
  readonly shadows: number;
}

/**
 * Ogre's change into True Ogre: its script by the human's side (each event its frame, what (2 or
 * 3 a side's move, from a frame to a last, 5 the fade to white at a step a frame, 6 its song, -1
 * the end) and three arguments).
 */
export interface OgreChangeTables {
  readonly scripts: readonly (readonly (readonly [number, number, number, number, number])[])[];
}

/** A best time: its frames and its holder's initials. */
export interface TimeRecord {
  readonly frames: number;
  readonly initials: string;
}

/** A survival record: the character, its wins and its holder's initials. */
export interface SurvivalRecord {
  readonly roster: number;
  readonly wins: number;
  readonly initials: string;
}

/**
 * The records screen's tables (its overlay, BNS 11): the stages it never circles, the ranks'
 * endings, each ranking's colour numbers for a row (rank, name, figures, initials; plain and
 * highlighted), and each character's bar colours (0xBBGGRR: the end, the face's two shades, the
 * top's two); and the name entry's.
 */
export interface RecordsTables {
  readonly skipped: readonly number[];
  readonly suffixes: readonly string[];
  readonly colours: { readonly times: readonly (readonly number[])[]; readonly survivors: readonly (readonly number[])[]; readonly plays: readonly (readonly number[])[] };
  readonly bars: readonly (readonly number[])[];
  readonly naming: NameTables;
}

/**
 * The name entry's tables: the letters it turns through in order (with `<` stepping back and `=`
 * ending the name), the name it starts from, the names it refuses (made the character's own), the
 * name that earns the hidden character, and the initials a new record has before its name (from
 * the mode's overlay).
 */
export interface NameTables {
  readonly letters: string;
  readonly blank: string;
  readonly refused: readonly string[];
  readonly secret: string;
  readonly fresh: string;
}

/** A line printed under the title by which pads are in: its text, and half its width in the screen's pixels. */
export interface StartLine {
  readonly text: string;
  readonly half: number;
}

/** An entry of the mode menu: its name, the mode it starts, whether it needs both pads, its printer colour. */
export interface MenuEntry {
  readonly name: string;
  readonly mode: number;
  readonly twoPads: boolean;
  readonly colour: number;
}

/** One of the character select's two sides: its portrait's left, its name's centre, whether its portrait faces the other way, and the cell its cursor starts on. */
export interface SelectSide {
  readonly portraitX: number;
  readonly nameCentre: number;
  readonly mirror: number;
  readonly firstCell: number;
  readonly cursorOffset: number;
}

/** The character select's places for one row of characters or two. */
export interface SelectLayout {
  readonly portraitTop: number;
  readonly nameY: number;
  readonly bandY: number;
  readonly gridDown: number;
  readonly cursorHeight: number;
  readonly cursorTop: number;
  readonly tagY: number;
  readonly timerY: number;
  readonly coinColour: number;
}

/**
 * A character added past the game's 22: its roster id, the cell it takes (shown from a fresh game,
 * an eleventh in its row included; the character the grid keeps there is in another cell too), its
 * look word, and Arcade's first opponent for it.
 */
export interface AddedCharacter {
  readonly roster: number;
  readonly cell: number;
  readonly look: number;
  readonly firstOpponent: number;
}

/** The character select's tables. */
export interface SelectTables {
  /** The roster id in each of the 22 cells, eleven a row. */
  readonly grid: readonly number[];
  readonly sides: readonly SelectSide[];
  /** By a side's state: its cursor's kind and its name's kind; and whether it counts as chosen and as a human's when two choices are kept apart. */
  readonly kinds: readonly (readonly [number, number])[];
  readonly apart: readonly (readonly [number, number])[];
  /** The places with one row and with two. */
  readonly layouts: readonly SelectLayout[];
  /** Each roster code's look (roster id × 4 + costume; the last row the empty one's): its portrait number (low five bits), mirrored (0x20), its fade bands (the top two bits), the colour of the light behind it (the upper three bytes). */
  readonly looks: readonly number[];
  /** The wall climbing behind the portraits: eight rows of eight tiles, by tile number. */
  readonly wall: readonly (readonly number[])[];
  /** The lines a side not yet in shows (by which pad is present), and the ones it alternates with. */
  readonly coinLines: readonly StartLine[];
  readonly creditLines: readonly StartLine[];
  readonly added: readonly AddedCharacter[];
}

/** A place on the versus screen: where a thing stands, and the offsets it slides in from. */
export interface VersusPlace {
  readonly x: number;
  readonly y: number;
  readonly slideX: number;
  readonly slideY: number;
}

/** The versus screen: each side's portrait and name places, its lines' texts, each background's band. */
export interface VersusTables {
  readonly portraits: readonly VersusPlace[];
  readonly names: readonly VersusPlace[];
  readonly versus: string;
  readonly stage: string;
  readonly demoStage: string;
  readonly bands: readonly { readonly colour: number; readonly width: number }[];
  /** Each background's archive, as the versus screen notes the one it last loaded. */
  readonly backgrounds: readonly number[];
}

export interface SceneTables {
  readonly powerOn: PowerOn;
  /** The title's two copyright lines. */
  readonly copyright: readonly [string, string];
  /** The line under the title with no pad in, the first, the second, or both. */
  readonly startLines: readonly StartLine[];
  /** The mode menu's entries in their order. */
  readonly menu: readonly MenuEntry[];
  /** The buttons a key configuration's values give (a pad's first eight bits), and the fixed ones (its last eight). */
  readonly keyBits: readonly number[];
  readonly fixedKeys: readonly number[];
  readonly select: SelectTables;
  readonly versus: VersusTables;
  readonly records: RecordsTables;
  /** The attract demo's characters, in the order it takes them (those earned). */
  readonly demoFighters: readonly number[];
  /** The attract overlay's intros. */
  readonly intros: readonly IntroTables[];
  readonly ogreChange: OgreChangeTables;
  /** The unlock schedule: fourteen steps of a kind (0 nothing, 1 a character, 2 a costume, 3 and 4 the hidden modes, 5 everything) and a value; and the endings (bits by roster id) that each move it a step. */
  readonly schedule: readonly (readonly [number, number])[];
  readonly endingSteps: number;
  readonly movies: MovieTables;
  readonly credits: CreditsTables;
}

/** A movie: its file, its frames' width and height, the frames it plays (from 1), its volume (of 127) and its flags. */
export interface MovieRecord {
  readonly file: number;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly volume: number;
  readonly flags: number;
}

/** A movie file: its first and last sectors in the XA file, and its stream as the drive reads it: its sectors, its frames a second, and the sector each frame's data ends on (frame 1 first). */
export interface MovieStream {
  readonly first: number;
  readonly last: number;
  readonly sectors: number;
  readonly rate: number;
  readonly ends: readonly number[];
}

/**
 * The movies: each file's stream (file 0, the music, none), the Theater's movie records (the
 * title's are the first `titleMovies`), and the endings' movie per roster and costume (-1 none).
 */
export interface MovieTables {
  readonly files: readonly (MovieStream | null)[];
  readonly movies: readonly MovieRecord[];
  readonly titleMovies: number;
  readonly endings: readonly (readonly number[])[];
  /** The endings' captions: cues (a frame, and the caption from it on, -1 none) in sets each opening with a cue at frame 0, and each caption's place on the frame, size and palette. */
  readonly cues: readonly { readonly frame: number; readonly caption: number }[];
  readonly captions: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly palette: number }[];
}

/** The credits: the title's two lines, the staff list (each line led by its kind: 0 a heading, 1 a name, 2 blank, 3 and 4 a heading as Tekken Ball is earned or not, 5 a name once Anna's third costume is), and the widths of the roll's small and large type from '!'. */
export interface CreditsTables {
  readonly title: readonly string[];
  readonly staff: readonly string[];
  readonly smallWidths: readonly number[];
  readonly largeWidths: readonly number[];
}
