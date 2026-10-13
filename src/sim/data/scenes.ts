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
    /** Whether the progress is saved on its own as records change, and the display's place (its steps across and down). */
    readonly autoSave: number;
    readonly display: { readonly x: number; readonly y: number };
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
  /** Per character its Arcade plays, versus wins, versus losses and versus draws; the endings seen (first costume, second); the newest character earned; the plays since the last unlock; the unlock schedule's step and whether it has started. */
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
  /** The line in the stage's place for a versus match (`%d` its number). */
  readonly fight: string;
  readonly demoStage: string;
  readonly bands: readonly { readonly colour: number; readonly width: number }[];
  /** Team Battle's portrait and name places, and each side's row of its team's icons: its start, the step between icons, and its start for a team of eight. */
  readonly teamPortraits: readonly VersusPlace[];
  readonly teamNames: readonly VersusPlace[];
  readonly teamIcons: readonly { readonly x: number; readonly y: number; readonly step: number; readonly xOfEight: number }[];
  /** Each background's archive, as the versus screen notes the one it last loaded. */
  readonly backgrounds: readonly number[];
}

/** A place on the screen. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One of the versus select's two sides: its cursor's colour set (its low two bits), the
 * code its cursor starts on, its tag's offsets (as a choosing cursor, and a partner's), its name's
 * place (its centre), its slots' places (for one player, versus, teams), and its handicap gauge:
 * whether it runs right (mirrored), where it is while its side chooses a handicap, where it rests,
 * and its labels' offsets (across from the gauge, a line down).
 */
export interface VsSelectSideLayout {
  readonly cursor: number;
  readonly firstCode: number;
  readonly tags: readonly [number, number];
  readonly name: Point;
  readonly slots: readonly [Point, Point, Point];
  readonly gauge: { readonly mirrored: number; readonly raised: number; readonly x: number; readonly y: number; readonly life: Point; readonly percent: Point };
}

/** A quad of the versus select's background: its corners (top left, top right, bottom left, bottom right) and their colours (0xbbggrr; all ones the mode's colour). */
export interface VsSelectQuad {
  readonly corners: readonly Point[];
  readonly colours: readonly number[];
}

/** The versus select's tables. */
export interface VsSelectTables {
  /** The grid, seven cells a row and three rows: each cell's place and its character's code (a roster id times four). */
  readonly grid: readonly { readonly x: number; readonly y: number; readonly code: number }[];
  /** By a side's state: its cursor's, name's and slot's kinds; and whether it counts as chosen and as a human's when two choices are kept apart. */
  readonly kinds: readonly (readonly [number, number, number])[];
  readonly apart: readonly (readonly [number, number])[];
  readonly sides: readonly VsSelectSideLayout[];
  /** The title by mode, the hint it alternates with (its colours switched by `%c`), and the tournament's line. */
  readonly titles: readonly string[];
  readonly hint: string;
  readonly tournament: string;
  /** Each mode's two colours (0xbbggrr): the opaque quads', the added ones'. */
  readonly modeColours: readonly (readonly [number, number])[];
  readonly opaque: readonly VsSelectQuad[];
  readonly added: readonly VsSelectQuad[];
  /** The colours of the versus wins' and draws' counts, by their hundreds. */
  readonly winColours: readonly number[];
  readonly drawColours: readonly number[];
  /** The handicap gauge's segments' widths (the first always lit), and its labels: its name and each handicap's health. */
  readonly segments: readonly number[];
  readonly life: string;
  readonly percents: readonly string[];
}

/** The results after a run: Time Attack's stages' places, Survival's places for the characters beaten and its counts' colours by hundreds, and the ranking's endings (first, second, third, the rest). */
export interface ResultsTables {
  readonly stages: readonly Point[];
  readonly beaten: readonly Point[];
  readonly countColours: readonly number[];
  readonly ordinals: readonly string[];
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
  readonly vsSelect: VsSelectTables;
  readonly results: ResultsTables;
  readonly records: RecordsTables;
  /** The attract demo's characters, in the order it takes them (those earned). */
  readonly demoFighters: readonly number[];
  /** The attract overlay's intros. */
  readonly intros: readonly IntroTables[];
  readonly ogreChange: OgreChangeTables;
  readonly options: OptionsTables;
  readonly theater: TheaterTables;
  readonly practice: PracticeTables;
  /** The unlock schedule: fourteen steps of a kind (0 nothing, 1 a character, 2 a costume, 3 and 4 the hidden modes, 5 everything) and a value; and the endings (bits by roster id) that each move it a step. */
  readonly schedule: readonly (readonly [number, number])[];
  readonly endingSteps: number;
  readonly movies: MovieTables;
  readonly credits: CreditsTables;
}

/**
 * Practice: each mode's menu's eight items (by id), the values' names, the lines with an arrow
 * (`d` and `u` where the arrows go), the menus' and the HUD's lines (`%d` where a number goes),
 * and each character's combos (by moveset), each its inputs (a word each: the buttons in its low
 * nibble, the direction in the next, its frames from bit 16, whether it is mirrored in bit 31).
 */
export interface PracticeTables {
  readonly items: readonly (readonly number[])[];
  readonly values: {
    readonly onOff: readonly string[];
    readonly okCancel: readonly string[];
    readonly dummies: readonly string[];
    readonly replays: readonly string[];
    readonly difficulties: readonly string[];
    readonly stages: readonly string[];
    readonly numbers: readonly string[];
  };
  readonly arrows: readonly string[];
  readonly lines: PracticeLines;
  readonly combos: readonly (readonly (readonly number[])[])[];
}

/** Practice's lines. */
export interface PracticeLines {
  readonly modeSelect: string;
  readonly modes: readonly string[];
  readonly commandList: string;
  readonly trainingDummy: string;
  readonly counterAttacks: string;
  readonly attackData: string;
  readonly hitAnalysis: string;
  readonly comboReplay: string;
  readonly returnToModeSelect: string;
  readonly vsCpu: string;
  readonly cpuDifficulty: string;
  readonly cpuLevel: string;
  readonly comboPlayer: string;
  readonly comboType: string;
  readonly none: string;
  readonly playSelect: string;
  readonly playMark: string;
  readonly startRecord: string;
  readonly recording: string;
  readonly playing: string;
  readonly replaySelect: string;
  readonly totalDamage: string;
  readonly damage: string;
  readonly counter: string;
  readonly cleanHit: string;
  readonly comboHits: string;
  readonly comboDamage: string;
  readonly title: string;
}

/**
 * A Theater entry: its movie, the movie a second ending plays instead, its thumbnail, the endings
 * (bits) that open it and how (0 any of them; 1 and 2 any, the second's movie once the second
 * ending is seen; 3 the second endings' Tiger), its name (a digit for the four the endings name)
 * and its one or two lines. A movie of -2 is an empty cell.
 */
export interface TheaterMovie {
  readonly movie: number;
  readonly alt: number;
  readonly picture: number;
  readonly bits: number;
  readonly kind: number;
  readonly name: string;
  readonly lines: readonly string[];
}

/** A box the Theater draws: its place and size, its flags (1 shaded from its corners, 2 a bit of blue in its first), its border's bars' width and height (0 none), its corners' colours and its border's. */
export interface TheaterBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly flags: number;
  readonly across: number;
  readonly down: number;
  readonly corners: readonly number[];
  readonly border: number;
}

/**
 * The Theater's menu: the movies' grid, the songs (each its code: twice its song), the help
 * lines, the titles by page (the movies, the remixed music, the arcade music), the line to play,
 * the buttons' and the music sets' names, the name of an entry not yet open, the CANCEL line, the
 * names the four shared entries show (the first ending's, the second's, both), the boxes (the
 * background, the info panel, the grid's cursor).
 */
export interface TheaterTables {
  readonly movies: readonly TheaterMovie[];
  readonly songs: readonly { readonly code: number; readonly name: string }[];
  readonly help: readonly string[];
  readonly titles: readonly string[];
  readonly play: string;
  readonly buttons: { readonly disc: string; readonly music: string; readonly exit: string; readonly theater: string; readonly bgm: string };
  readonly sets: readonly string[];
  readonly unknown: string;
  readonly cancel: readonly string[];
  readonly endingNames: readonly (readonly string[])[];
  readonly boxes: readonly TheaterBox[];
}

/** What an Options list's item changes: the page shown, one of the options, or nothing. */
export type OptionValue = 'none' | 'page' | 'stereo' | 'musicSet' | 'difficulty' | 'rounds' | 'roundTime' | 'alwaysChip' | 'continueChooses' | 'modeSetting' | 'autoSave' | 'keepChoices';

/**
 * An item of an Options list: what it changes, its label and its values' names, how left and
 * right change it (0 not at all, 1 through its values, 2 a switch whose turning on asks the
 * memory card), how many values it has, what a button does (0 nothing, 1 and 2 set its value, 3
 * opens a memory card screen), the value a button sets (or for left and right, the default), how
 * its row is drawn (0 not, 1 the label, 2 with its value at the row's right), and the modes it
 * applies to (a bit per mode).
 */
export interface OptionsItem {
  readonly value: OptionValue;
  readonly label: string;
  readonly names: readonly string[];
  readonly sideways: number;
  readonly count: number;
  readonly button: number;
  readonly set: number;
  readonly draw: number;
  readonly modes: number;
}

/** A page of the Options: its title (empty none) and place, its list's place, its rows' step and width, the page select goes back to (-1 none), its items. */
export interface OptionsPage {
  readonly title: string;
  readonly titleX: number;
  readonly titleY: number;
  readonly listX: number;
  readonly listY: number;
  readonly step: number;
  readonly width: number;
  readonly cancel: number;
  readonly items: readonly OptionsItem[];
}

/** A button's box on the key configuration: its bit, its key (of a pad's eight), its table entry closed, its places closed and open, where its line starts closed and open (from the box), and its colour (blue, green, red). */
export interface OptionsKey {
  readonly bit: number;
  readonly key: number;
  readonly layer: number;
  readonly closed: Point;
  readonly open: Point;
  readonly lineClosed: Point;
  readonly lineOpen: Point;
  readonly colour: number;
}

/**
 * The Options: its pages; the modes' labels in the box of the modes an option applies to (each
 * its mode and its colour); the key configuration's value names, vibration's, each button's box,
 * the points on the pad's two pictures (the DualShock's, the standard pad's) its lines reach, the
 * keys by default; and the pages' lines (those that change colour split where they do).
 */
export interface OptionsTables {
  readonly pages: readonly OptionsPage[];
  readonly labels: readonly { readonly mode: number; readonly colour: number }[];
  readonly keyNames: readonly string[];
  readonly vibrationNames: readonly string[];
  readonly keys: readonly OptionsKey[];
  readonly padPoints: readonly (readonly Point[])[];
  readonly defaultKeys: readonly number[];
  readonly lines: OptionsLines;
}

/** The Options' lines. */
export interface OptionsLines {
  readonly save: readonly string[];
  readonly load: readonly string[];
  readonly cancel: readonly string[];
  readonly yes: readonly string[];
  readonly no: readonly string[];
  readonly saved: string;
  readonly saveError: string;
  readonly loaded: string;
  readonly loadError: string;
  readonly noCard: string;
  readonly full: string;
  readonly noFile: string;
  readonly other: string;
  readonly format: string;
  readonly display: string;
  readonly displayDefault: readonly string[];
  readonly displayExit: readonly string[];
  readonly keyConfig: string;
  readonly setting: string;
  readonly vibration: string;
  readonly keyDefault: string;
  readonly keyExit: string;
  readonly records: string;
  readonly page: string;
  readonly next: readonly string[];
  readonly exit: readonly string[];
  readonly headers: readonly string[];
  readonly titles: readonly string[];
  readonly suffixes: readonly string[];
  readonly win: string;
  readonly wins: string;
  readonly none: string;
  readonly all: string;
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
