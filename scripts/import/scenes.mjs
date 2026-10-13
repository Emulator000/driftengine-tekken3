/**
 * What the remake's scenes read (`tables/scenes.json`): the scenes' shared bytes as the executable
 * starts them (`0x80097f38` on: the logo scene's next and last scenes, the attract flags, the
 * attract cycle's step; `0x80097f1f` and `0x80097f20` the intros earned and shown); the lines under
 * the title by which pads are in (`0x800220bc`, a string and half its width each); and from the
 * title overlay (BNS 10, loaded at `0x800b8d58`) its two copyright lines (their format's leading
 * colour and place codes dropped), the mode menu's ten entries (`0x800b8e44`, eight bytes each:
 * the name, the mode, whether it needs both pads, the colour) and the key configuration's buttons
 * (`0x800b94d0`, by value; `0x800b94ec`, the fixed last eight). The options start at `0x80097f06`
 * (`0x80097f19` whether the last choices are kept), each pad's key configuration at `0x80097f28`,
 * what is earned of Tekken Ball and the Theater at `0x80097f26`, the menu's pick at `0x80097f40`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { creditsTable, moviesTable } from './movies.mjs';

const TITLE_OVERLAY = 0x800b8d58;
const START_LINES = 0x800220bc;
const COPYRIGHT = [0, 0x2c];
const MENU = 0x800b8e44 - TITLE_OVERLAY;
const KEY_BITS = 0x800b94d0 - TITLE_OVERLAY;
const FIXED_KEYS = 0x800b94ec - TITLE_OVERLAY;
const KEY_VALUES = 13;
const PLACED = '%c%H%V';
/**
 * The character select's overlay (BNS 9, also loaded at `0x800b8d58`): each side's layout (ten
 * words from the overlay's start: portrait's left and name's centre, picture place, palette, page,
 * mirrored, cursor pictures, first cell and cursor offset), the grid's roster ids (`0x800b9018`),
 * by a side's state the kinds kept apart (`0x800b903c`) and its cursor and name kinds
 * (`0x800b904c`), and the layouts for one row and two (`0x801102dc`, twelve words each).
 */
const SELECT_OVERLAY = 0x800b8d58;
const GRID = 0x800b9018 - SELECT_OVERLAY;
const APART = 0x800b903c - SELECT_OVERLAY;
const KINDS = 0x800b904c - SELECT_OVERLAY;
const LAYOUTS = 0x801102dc - SELECT_OVERLAY;
/** The wall climbing behind the portraits: its eight rows of eight tiles (`0x801185bc`, a tile number each). */
const WALL = 0x801185bc - SELECT_OVERLAY;
/** Each roster code's look record (`0x80097ab8`, a pointer per costume, the empty row last), the lines under a side not in (`0x80022134`, `0x8002216c`). */
const LOOKS = 0x80097ab8;
const COIN_LINES = 0x80022134;
const CREDIT_LINES = 0x8002216c;
/**
 * Kazuya, when his files are built: roster id 22 in the first row's eleventh cell (10), beside Jin,
 * which the grid otherwise keeps for Gon, who is the second row's eleventh too; Jin his first
 * opponent; his look (portrait 22 mirrored, the first bands, a violet light).
 */
const KAZUYA = { roster: 22, cell: 10, look: (22 | 0x20 | (0x9c1c6c << 8)) >>> 0, firstOpponent: 9 };

/**
 * The versus screen, from the Arcade mode's overlay (BNS 5, loaded at `0x800b0548`): each side's
 * portrait place and its name's (`0x800b4a08`, `0x800b4a18`: x, y, then the slide's offsets), the
 * line between the portraits, the stage's line and a versus match's (their formats' leading colour,
 * font and place codes dropped), Team Battle's portrait and name places (`0x800b4a28`,
 * `0x800b4a38`) and each side's row of its team's icons (`0x800b06d4`: x, y, the step between
 * icons, and x for a team of eight); from the executable the bands, seven of them (`0x80022694`
 * colour, `0x800226b0` width), and each background's archive (`0x80022690`, a logical file).
 */
const MODE_OVERLAY = 0x800b0548;
function versusTables(exe, root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/005.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - MODE_OVERLAY;
  const byte = (offset) => overlay[offset] ?? 0;
  const place = (table, side) => {
    const word = (k) => view.getInt16(at(table) + side * 8 + k * 2, true);
    return { x: word(0), y: word(1), slideX: word(2), slideY: word(3) };
  };
  const text = (address) => {
    const format = cString(byte, at(address));
    if (!format.startsWith('%c%f%H%V')) throw new Error(`a versus line at 0x${address.toString(16)} does not start with its place: ${format}`);
    return format.slice(8);
  };
  return {
    portraits: [0, 1].map((side) => place(0x800b4a08, side)),
    names: [0, 1].map((side) => place(0x800b4a18, side)),
    versus: text(0x800b06e4),
    stage: text(0x800b06f0),
    fight: text(0x800b0704),
    demoStage: text(0x800b0718),
    bands: Array.from({ length: 7 }, (_, band) => ({ colour: exe.u32(0x80022694 + band * 4), width: exe.u16(0x800226b0 + band * 2) })),
    teamPortraits: [0, 1].map((side) => place(0x800b4a28, side)),
    teamNames: [0, 1].map((side) => place(0x800b4a38, side)),
    teamIcons: [0, 1].map((side) => ({ x: view.getInt16(at(0x800b06d4) + side * 8, true), y: view.getInt16(at(0x800b06d4) + side * 8 + 2, true), step: view.getInt16(at(0x800b06d4) + side * 8 + 4, true), xOfEight: view.getInt16(at(0x800b06d4) + side * 8 + 6, true) })),
    backgrounds: [0, 1].map((picture) => exe.u16(0x80022690 + picture * 2)),
  };
}

/**
 * The versus select (scene 10), from the executable: its grid of seven cells by three
 * (`0x80022768`, six bytes each: x, y, the character's code), by a side's state its cursor's,
 * name's and slot's kinds (`0x80022824`, three bytes) and the kinds kept apart (`0x80022804`, two),
 * each side's layout (`0x80098160`, thirteen words: its cursor's colour, two tag pictures, the
 * code its cursor starts on, its tags' offsets, its name's place, its slots' places for one
 * player, for versus and for teams, its gauge's side, raised place and place, and its gauge's two
 * labels' offsets), the titles by mode (`0x800981c8`), the hint (`0x800981e0`), the tournament's
 * line (`0x800981ec`), each mode's two colours (`0x80022b4c`), and the background's quads, four
 * opaque (`0x80022a8c`) and two added (`0x80022b0c`), each four corners and four colours (all
 * ones the mode's colour); from the mode overlay (BNS 5) the wins' and the draws' colours by hundreds (`0x800b49e0`, `0x800b49e4`), and the handicap
 * gauge's segments' widths (`0x800b065c`, six bytes each) and labels (`0x800b06cc`, and
 * `0x800b49e8` one by handicap).
 */
const VS_GRID = 0x80022768;
const VS_KINDS = 0x80022824;
const VS_APART = 0x80022804;
const VS_SIDES = 0x80098160;
const VS_TITLES = 0x800981c8;
const VS_HINT = 0x800981e0;
const VS_TOURNAMENT = 0x800981ec;
const VS_COLOURS = 0x80022b4c;
const VS_OPAQUE = 0x80022a8c;
const VS_ADDED = 0x80022b0c;
function vsSelectTables(exe, root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/005.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - MODE_OVERLAY;
  const byte = (offset) => overlay[offset] ?? 0;
  const half = (word) => [(word << 16) >> 16, word >> 16];
  const place = (word) => ({ x: (word << 16) >> 16, y: word >> 16 });
  const quads = (table, count) =>
    Array.from({ length: count }, (_, q) => ({
      corners: Array.from({ length: 4 }, (_, k) => place(exe.u32(table + q * 0x20 + k * 4))),
      colours: Array.from({ length: 4 }, (_, k) => exe.u32(table + q * 0x20 + 0x10 + k * 4) >>> 0),
    }));
  return {
    grid: Array.from({ length: 21 }, (_, k) => ({ x: exe.s16(VS_GRID + k * 6), y: exe.s16(VS_GRID + k * 6 + 2), code: exe.u8(VS_GRID + k * 6 + 4) })),
    kinds: Array.from({ length: 16 }, (_, k) => [0, 1, 2].map((i) => exe.u8(VS_KINDS + k * 3 + i))),
    apart: Array.from({ length: 16 }, (_, k) => [0, 1].map((i) => exe.u8(VS_APART + k * 2 + i))),
    sides: [0, 1].map((n) => {
      const word = (k) => exe.u32(VS_SIDES + n * 0x34 + k * 4);
      const [mirrored, raised] = half(word(8));
      const gauge = place(word(9));
      return {
        cursor: word(0),
        firstCode: word(3),
        tags: half(word(4)),
        name: place(word(5)),
        slots: [place(word(6)), place(word(7)), place(word(12))],
        gauge: { mirrored, raised, x: gauge.x, y: gauge.y, life: place(word(10)), percent: place(word(11)) },
      };
    }),
    titles: Array.from({ length: 9 }, (_, mode) => cString(exe.u8, exe.u32(VS_TITLES + mode * 4))),
    hint: cString(exe.u8, exe.u32(VS_HINT)),
    tournament: cString(exe.u8, VS_TOURNAMENT),
    modeColours: Array.from({ length: 9 }, (_, mode) => [exe.u32(VS_COLOURS + mode * 8) >>> 0, exe.u32(VS_COLOURS + mode * 8 + 4) >>> 0]),
    opaque: quads(VS_OPAQUE, 4),
    added: quads(VS_ADDED, 2),
    winColours: Array.from(overlay.subarray(at(0x800b49e0), at(0x800b49e0) + 4)),
    drawColours: Array.from(overlay.subarray(at(0x800b49e4), at(0x800b49e4) + 4)),
    segments: Array.from({ length: 8 }, (_, k) => byte(at(0x800b065c) + k * 6)),
    life: cString(byte, at(0x800b06cc)),
    percents: Array.from({ length: 8 }, (_, k) => cString(byte, at(view.getUint32(at(0x800b49e8) + k * 4, true))).replace('%%', '%')),
  };
}

/**
 * The results after a run, from their overlay (BNS 302, loaded at `0x800b8d58`): Time Attack's ten
 * stages' places (`0x800b8ed4`, x and y), Survival's places for the characters beaten
 * (`0x800b8fec`, 21 of them) and its counts' colours by hundreds (`0x800b90dc`), and the ranking's
 * endings for first, second, third and the rest (`0x800f2398`, from its second pointer).
 */
const RESULTS_OVERLAY = 0x800b8d58;
function resultsTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/302.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - RESULTS_OVERLAY;
  const places = (table, count) => Array.from({ length: count }, (_, k) => ({ x: view.getInt16(at(table) + k * 4, true), y: view.getInt16(at(table) + k * 4 + 2, true) }));
  return {
    stages: places(0x800b8ed4, 10),
    beaten: places(0x800b8fec, 21),
    countColours: Array.from(overlay.subarray(at(0x800b90dc), at(0x800b90dc) + 4)),
    ordinals: Array.from({ length: 4 }, (_, k) => cString((i) => overlay[i] ?? 0, at(view.getUint32(at(0x800f2398) + (k + 1) * 4, true)))),
  };
}

/**
 * Ogre's change into True Ogre, from the Arcade mode's overlay (BNS 5): its two scripts, by the
 * human's side (`0x800b0728` the first, `0x800b075c` the second; events of five halfwords, the
 * frame, what, and its arguments, up to the one that ends it).
 */
function ogreChangeTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/005.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const script = (address) => {
    const events = [];
    for (let at = address - MODE_OVERLAY; events.length < 16; at += 10) {
      const event = Array.from({ length: 5 }, (_, j) => view.getInt16(at + j * 2, true));
      events.push(event);
      if (event[1] === -1) return events;
    }
    throw new Error(`Ogre's change's script at 0x${address.toString(16)} has no end`);
  };
  return { scripts: [script(0x800b0728), script(0x800b075c)] };
}

/**
 * The records screen's overlay (BNS 11, also loaded at `0x800b8d58`): the stages it never circles
 * (`0x800cb868`), the ranks' endings (`0x800cb828`), each ranking's row colours (`0x800cb838`
 * five a row, `0x800cb844` four, `0x800cb84c` three; plain then highlighted) and each character's
 * bar colours (the overlay's first words, five a character). The name entry's: its 40 letters in
 * turn (`0x800b9054`), the name it starts from (`0x800b908c`), the five it refuses (`0x800cb854`,
 * a pointer each), and the one that earns the hidden character (`0x800b9090`); and from the mode
 * overlay (BNS 5) the initials a new record is given (`0x800b0790`).
 */
const RECORDS_OVERLAY = 0x800b8d58;
const NAME_LETTERS = 40;
function recordsTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/011.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - RECORDS_OVERLAY;
  const rows = (address, size) => [0, 1].map((k) => Array.from(overlay.subarray(at(address) + k * size, at(address) + k * size + size)));
  const text = (address) => cString((o) => overlay[o] ?? 0, at(address));
  const mode = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/005.bin')));
  return {
    skipped: Array.from({ length: 4 }, (_, i) => view.getInt32(at(0x800cb868) + i * 4, true)),
    suffixes: Array.from({ length: 4 }, (_, i) => cString((o) => overlay[o] ?? 0, view.getUint32(at(0x800cb828) + i * 4, true) - RECORDS_OVERLAY)),
    colours: { times: rows(0x800cb838, 5), survivors: rows(0x800cb844, 4), plays: rows(0x800cb84c, 3) },
    bars: Array.from({ length: 22 }, (_, roster) => Array.from({ length: 5 }, (_, k) => view.getUint32(roster * 0x14 + k * 4, true))),
    naming: {
      letters: text(0x800b9054).slice(0, NAME_LETTERS),
      blank: text(0x800b908c),
      refused: Array.from({ length: 5 }, (_, i) => text(view.getUint32(at(0x800cb854) + i * 4, true))),
      secret: text(0x800b9090),
      fresh: cString((o) => mode[o] ?? 0, 0x800b0790 - MODE_OVERLAY),
    },
  };
}

/**
 * The attract overlay's intros (BNS 0, loaded at `0x800b8d58`), three of them: each its script
 * (`0x800b8e3c`, 450 bytes an intro: events of five halfwords, the frame, what, and its arguments,
 * up to the one that ends it), its packs' model pairs in its archive (`0x800b9384`, a byte a pack,
 * signed), and the archive's member its shadows start at (`0x800dd814`).
 */
function introTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/000.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - 0x800b8d58;
  return [0, 1, 2].map((intro) => {
    const events = [];
    for (let k = 0; k < 45; k += 1) {
      const event = Array.from({ length: 5 }, (_, j) => view.getInt16(at(0x800b8e3c) + intro * 0x1c2 + k * 10 + j * 2, true));
      events.push(event);
      if (event[1] === -1) break;
    }
    return {
      script: events,
      pairs: Array.from({ length: 0x2d }, (_, pack) => view.getInt8(at(0x800b9384) + intro * 0x2d + pack)),
      shadows: overlay[at(0x800dd814) + intro],
    };
  });
}

/**
 * Arcade's best times (`0x80097f44`: the record just set, then a time and four letters a
 * character) and survival's ten best (`0x80097ffc`; `0x80097f48` the one just set); whether a
 * record waits for its name (`0x800980fe`), and the side that set it and its character
 * (`0x800980ff`, `0x80098100`).
 */
const TIMES = 0x80097f44;
const SURVIVORS = 0x80097ffc;
function bestRecords(exe) {
  const initials = (address) => cString(exe.u8, address).slice(0, 4);
  const set = exe.u32(TIMES);
  const survivorSet = exe.u32(TIMES + 4);
  return {
    times: Array.from({ length: 22 }, (_, roster) => ({ frames: exe.u32(TIMES + 8 + roster * 8), initials: initials(TIMES + 12 + roster * 8) })),
    timeSet: set === 0 ? -1 : (set - TIMES - 8) / 8,
    survivors: Array.from({ length: 10 }, (_, i) => ({ roster: exe.u16(SURVIVORS + i * 8), wins: exe.u16(SURVIVORS + 2 + i * 8), initials: initials(SURVIVORS + 4 + i * 8) })),
    survivorSet: survivorSet === 0 ? -1 : (survivorSet - SURVIVORS) / 8,
    list: exe.u8(0x800980fc),
    stageTurn: exe.u8(0x800980fd),
    naming: exe.u8(0x800980fe),
    holder: { side: exe.u8(0x800980ff), roster: exe.u8(0x80098100) },
    demoTurn: exe.u8(0x80097f13),
  };
}

function selectTables(exe, root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/009.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const lines = (table, count) => Array.from({ length: count }, (_, i) => ({ text: cString(exe.u8, exe.u32(table + i * 8)), half: exe.u32(table + i * 8 + 4) }));
  const manifest = path.join(root, 'public/data/manifest.json');
  const kazuya = existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).kazuya === true;
  return {
    grid: Array.from(overlay.subarray(GRID, GRID + 22)),
    sides: [0, 1].map((n) => ({
      portraitX: view.getUint16(n * 0x28, true),
      nameCentre: view.getUint16(n * 0x28 + 2, true),
      mirror: view.getInt16(n * 0x28 + 0xc, true),
      firstCell: view.getUint16(n * 0x28 + 0x24, true),
      cursorOffset: view.getUint16(n * 0x28 + 0x26, true),
    })),
    kinds: Array.from({ length: 8 }, (_, k) => [overlay[KINDS + k * 2], overlay[KINDS + k * 2 + 1]]),
    apart: Array.from({ length: 8 }, (_, k) => [overlay[APART + k * 2], overlay[APART + k * 2 + 1]]),
    layouts: [0, 1].map((rows) => {
      const word = (i) => view.getInt32(LAYOUTS + rows * 0x30 + i * 4, true);
      return { portraitTop: word(1), nameY: word(2), bandY: word(3), gridDown: word(4), cursorHeight: word(6), cursorTop: word(7), tagY: word(8), timerY: word(9), coinColour: word(11) };
    }),
    looks: Array.from({ length: 23 * 4 }, (_, code) => exe.u32(exe.u32(LOOKS + code * 4))),
    wall: Array.from({ length: 8 }, (_, row) => Array.from(overlay.subarray(WALL + row * 8, WALL + row * 8 + 8))),
    coinLines: lines(COIN_LINES, 3),
    creditLines: lines(CREDIT_LINES, 2),
    added: kazuya ? [KAZUYA] : [],
  };
}

function cString(read, at) {
  let s = '';
  for (let c = read(at); c !== 0; at += 1, c = read(at)) s += String.fromCharCode(c);
  return s;
}

/**
 * The Theater's menu, from its overlay (BNS 301, loaded at `0x800b8d58`): the Tekken 3 movies'
 * grid (`0x800ba160`, 26 records of 0x1c bytes, six a row: the movie, the one a second ending
 * plays instead, the thumbnail, the endings (bits) that open it, how (0 any of them, 1 and 2 the
 * second's movie once that is seen, 3 Tiger's), the name (a digit for the four the endings name),
 * one or two lines); its songs (`0x800badac`, 29 of 0x1c bytes: the code and the name); the help
 * lines (`0x8010e1e4`), the title by page (`0x8010e21c` on, the Tekken 3 disc's, 12 bytes on), the
 * line to play, the buttons' and the sets' names, the CANCEL line; the names the four shared
 * entries show (the first ending's, the second's, both); and the three boxes (`0x800ba028`, 0x20
 * bytes: place, size, flags, border bars, four corner colours, the border's).
 */
const THEATER_OVERLAY = 0x800b8d58;
const ENDING_NAMES = [
  [0x800bab40, 0x800bb0e4, 0x800bb710],
  [0x800baabc, 0x800bb728, 0x800bb730],
  [0x800bb73c, 0x800bb0f8, 0x800bb0f8],
  [0x800bb104, 0x800bb0d8, 0x800bb74c],
];
function theaterTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/301.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - THEATER_OVERLAY;
  const u32 = (address) => view.getUint32(at(address), true);
  const s16 = (address) => view.getInt16(at(address), true);
  const text = (address) => cString((o) => overlay[o] ?? 0, at(address));
  const plain = (address) => text(address).replace(/^(%[cfhvHV])+/, '');
  const movies = Array.from({ length: 0x1a }, (_, i) => {
    const record = 0x800ba160 + i * 0x1c;
    const line2 = u32(record + 0x18);
    return {
      movie: s16(record),
      alt: s16(record + 2),
      picture: s16(record + 4),
      bits: u32(record + 8),
      kind: u32(record + 0xc),
      name: text(u32(record + 0x10)),
      lines: line2 === 0 ? [text(u32(record + 0x14))] : [text(u32(record + 0x14)), text(line2)],
    };
  });
  const songs = Array.from({ length: 0x1d }, (_, i) => ({ code: overlay[at(0x800badac + i * 0x1c)], name: text(u32(0x800badac + i * 0x1c + 0x10)) }));
  const boxes = Array.from({ length: 3 }, (_, i) => {
    const record = 0x800ba028 + i * 0x20;
    return {
      x: s16(record),
      y: s16(record + 2),
      w: s16(record + 4),
      h: s16(record + 6),
      flags: view.getUint16(at(record + 8), true),
      across: overlay[at(record + 0xa)],
      down: overlay[at(record + 0xb)],
      corners: [0, 1, 2, 3].map((k) => u32(record + 0xc + k * 4) & 0xffffff),
      border: u32(record + 0x1c) & 0xffffff,
    };
  });
  return {
    movies,
    songs,
    help: Array.from({ length: 8 }, (_, i) => text(u32(0x8010e1e4 + i * 4))),
    titles: [0x8010e21c, 0x8010e220, 0x8010e224].map((base) => text(u32(base + 3 * 12))),
    play: text(u32(0x8010e224)),
    buttons: { disc: text(0x800bb794), music: text(0x800bb79c), exit: text(0x800bb7a4), theater: text(0x800bb7c8), bgm: text(0x800bb7d0) },
    sets: [plain(0x800bb7dc), plain(0x800bb7ec)],
    unknown: plain(0x800bb7ac),
    cancel: text(0x800bb75c).replace(/^(%[cfhvHV])+/, '').split('%c'),
    endingNames: ENDING_NAMES.map((names) => names.map(text)),
    boxes,
  };
}

/**
 * Practice, from its overlay (BNS 6, loaded at `0x800b0548`): each mode's menu's items
 * (`0x800b0548`, eight a mode), the values' names (`0x800b8a30` on: off and on, OK and CANCEL,
 * the training dummy's, the combo replay's, the computer's difficulties and stages, the combo
 * numbers), the lines with an arrow in them (`0x800b8b40`), the menus' and the HUD's lines (their
 * format's leading codes dropped), and each character's combos (`0x800b25f8`, by moveset: a
 * pointer and a count; each combo 12 bytes, its inputs' pointer and count at +0 and +8, an input a
 * word: the buttons in its low nibble, the direction in the next, its frames from bit 16, whether
 * it is mirrored in bit 31).
 */
const PRACTICE_OVERLAY = 0x800b0548;
const PRACTICE_CHARACTERS = 20;
function practiceTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/006.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - PRACTICE_OVERLAY;
  const u32 = (address) => view.getUint32(at(address), true);
  const text = (address) => cString((o) => overlay[o] ?? 0, at(address));
  const plain = (address) => text(address).replace(/^(%[cfhvHV])+/, '');
  const names = (table, count) => Array.from({ length: count }, (_, i) => text(u32(table + i * 4)));
  return {
    items: [0, 1, 2].map((mode) => Array.from(overlay.subarray(at(0x800b0548 + mode * 8), at(0x800b0548 + mode * 8) + 8))),
    values: {
      onOff: names(0x800b8a30, 2),
      okCancel: names(0x800b8a38, 2),
      dummies: names(0x800b8a40, 9),
      replays: names(0x800b8a64, 5),
      difficulties: names(0x800b8a84, 3),
      stages: names(0x800b8a90, 10),
      numbers: names(0x800b8ac4, 20),
    },
    arrows: names(0x800b8b40, 3),
    lines: {
      modeSelect: plain(0x800b074c),
      modes: [0x800b0760, 0x800b0778, 0x800b0788, 0x800b07a0, 0x800b07b8].map(plain),
      commandList: text(0x800b07d4),
      trainingDummy: text(0x800b07e4),
      counterAttacks: text(0x800b07f8),
      attackData: text(0x800b0808),
      hitAnalysis: text(0x800b0814),
      comboReplay: text(0x800b0824),
      returnToModeSelect: text(0x800b0834),
      vsCpu: plain(0x800b084c),
      cpuDifficulty: text(0x800b085c),
      cpuLevel: text(0x800b086c),
      comboPlayer: plain(0x800b0878),
      comboType: text(0x800b0894),
      none: text(0x800b08a0),
      playSelect: plain(0x800b08a8),
      playMark: plain(0x800b08bc),
      startRecord: plain(0x800b08c4),
      recording: plain(0x800b08e0),
      playing: plain(0x800b08f8),
      replaySelect: plain(0x800b0918),
      totalDamage: plain(0x800b0930),
      damage: plain(0x800b0944),
      counter: plain(0x800b095c),
      cleanHit: plain(0x800b096c),
      comboHits: plain(0x800b09b0),
      comboDamage: plain(0x800b09c0),
      title: plain(0x800b09dc),
    },
    combos: Array.from({ length: PRACTICE_CHARACTERS }, (_, character) => {
      const [records, count] = [u32(0x800b25f8 + character * 8), u32(0x800b25fc + character * 8)];
      return Array.from({ length: count }, (_, k) => {
        const combo = records + k * 12;
        const inputs = u32(combo);
        return Array.from({ length: view.getUint16(at(combo + 8), true) }, (_, i) => u32(inputs + i * 4));
      });
    }),
  };
}

/** Where each option the Options' lists change is kept, by its name in the remake (the page shown is the scene's own). */
const OPTION_VALUES = {
  0x800ec020: 'page',
  0x80097f04: 'stereo',
  0x80097f05: 'musicSet',
  0x80097f06: 'difficulty',
  0x80097f07: 'rounds',
  0x80097f08: 'roundTime',
  0x80097f09: 'alwaysChip',
  0x80097f0a: 'continueChooses',
  0x80097f10: 'modeSetting',
  0x80097f11: 'autoSave',
  0x80097f19: 'keepChoices',
};

/**
 * The Options (scene 5), from the title overlay: its six pages (`0x800ead24`, 0x34 bytes each:
 * the title and its place, the list's place, its rows' step and width, its items, and where
 * select goes back to) and their items (0x14 bytes each: the option, the label, the values'
 * names, how left and right change it, how many values, what a button does and the value it sets
 * (for a value changed by left and right, its default), how the row is drawn, and the modes it
 * applies to); the modes' labels (`0x800eae90`, the mode and its picture's colour); the key
 * configuration's value names (`0x800eaed0`), vibration's (`0x800eaf04`), each button's box
 * (`0x800eaf0c`, 0x18 bytes: its bit, its key, its table entry closed, its places closed and
 * open, its line's start closed and open, its colour), the points on the pad's two pictures the
 * lines reach (`0x800b9564`) and the keys by default (`0x800b94fc`); and the pages' lines, their
 * format's leading codes dropped and split where the colour changes.
 */
function optionsTables(overlay) {
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - TITLE_OVERLAY;
  const u32 = (address) => view.getUint32(at(address), true);
  const s32 = (address) => view.getInt32(at(address), true);
  const s16 = (address) => view.getInt16(at(address), true);
  const text = (address) => cString((o) => overlay[o] ?? 0, at(address));
  const parts = (address) =>
    text(address)
      .replace(/^(%[cfhvHVp])+/, '')
      .replace(/\n$/, '')
      .replace(/%s$/, '')
      .split('%c')
      .map((part) => part.replaceAll('%%', '%'));
  const pages = Array.from({ length: 6 }, (_, p) => {
    const record = 0x800ead24 + p * 0x34;
    const items = u32(record + 0x20);
    return {
      title: u32(record + 0x24) === 0 ? '' : text(u32(record + 0x24)),
      titleX: s32(record + 8),
      titleY: s32(record + 0xc),
      listX: s32(record + 0x10),
      listY: s32(record + 0x14),
      step: s32(record + 0x18),
      width: s32(record + 0x1c),
      cancel: overlay[at(record + 0x30)] === 1 ? overlay[at(record + 0x31)] : -1,
      items: Array.from({ length: s32(record + 0x28) }, (_, i) => {
        const item = items + i * 0x14;
        const value = u32(item);
        const names = u32(item + 8);
        const count = overlay[at(item + 0xd)];
        if (value !== 0 && OPTION_VALUES[value] === undefined) throw new Error(`the Options' item at 0x${item.toString(16)} changes 0x${value.toString(16)}`);
        return {
          value: value === 0 ? 'none' : OPTION_VALUES[value],
          label: text(u32(item + 4)),
          names: names === 0 ? [] : Array.from({ length: count }, (_, k) => text(u32(names + k * 4))),
          sideways: overlay[at(item + 0xc)],
          count,
          button: overlay[at(item + 0xe)],
          set: overlay[at(item + 0xf)],
          draw: view.getUint16(at(item + 0x10), true),
          modes: view.getUint16(at(item + 0x12), true),
        };
      }),
    };
  });
  const point = (address) => ({ x: s16(address), y: s16(address + 2) });
  return {
    pages,
    labels: Array.from({ length: 8 }, (_, i) => ({ mode: u32(0x800eae90 + i * 8), colour: (u32(0x800eae94 + i * 8) >>> 16) & 0xf })),
    keyNames: Array.from({ length: KEY_VALUES }, (_, i) => text(u32(0x800eaed0 + i * 4))),
    vibrationNames: [0, 1].map((i) => text(u32(0x800eaf04 + i * 4))),
    keys: Array.from({ length: 8 }, (_, k) => {
      const box = 0x800eaf0c + k * 0x18;
      return {
        bit: view.getUint16(at(box), true),
        key: overlay[at(box + 2)],
        layer: overlay[at(box + 3)],
        closed: point(box + 4),
        open: point(box + 8),
        lineClosed: point(box + 0xc),
        lineOpen: point(box + 0x10),
        colour: u32(box + 0x14),
      };
    }),
    padPoints: [0, 1].map((t) => Array.from({ length: 8 }, (_, k) => ({ x: view.getUint16(at(0x800b9564 + t * 0x20 + k * 4), true), y: view.getUint16(at(0x800b9566 + t * 0x20 + k * 4), true) }))),
    defaultKeys: Array.from(overlay.subarray(at(0x800b94fc), at(0x800b94fc) + 8)),
    lines: {
      save: parts(0x800b93a8),
      load: parts(0x800b92d0),
      cancel: parts(0x800b92f0),
      yes: parts(0x800b93fc),
      no: parts(0x800b941c),
      saved: text(0x800b93c8),
      saveError: text(0x800b93d4),
      loaded: text(0x800b9310),
      loadError: text(0x800b931c),
      noCard: text(0x800b9328),
      full: text(0x800b9338),
      noFile: text(0x800b9348),
      other: text(0x800b935c),
      format: text(0x800b9390),
      display: parts(0x800b9458)[0],
      displayDefault: parts(0x800b9470),
      displayExit: parts(0x800b9490),
      keyConfig: parts(0x800b95f8)[0],
      setting: parts(0x800b95a4)[0],
      vibration: parts(0x800b95bc)[0],
      keyDefault: parts(0x800b95d8)[0],
      keyExit: parts(0x800b95e8)[0],
      records: parts(0x800b97a8)[0],
      page: parts(0x800b97b8)[0].replace(/%1x$/, ''),
      next: parts(0x800b97dc),
      exit: parts(0x800b97fc),
      headers: [0x800b9718, 0x800b973c, 0x800b9760, 0x800b9784].map((address) => parts(address)[0]),
      titles: Array.from({ length: 4 }, (_, i) => text(u32(0x800eaffc + i * 4))),
      suffixes: Array.from({ length: 4 }, (_, i) => text(u32(0x800eafec + i * 4))),
      win: text(0x800b96a0),
      wins: text(0x800b96a4),
      none: parts(0x800b964c)[0],
      all: parts(0x800b9654)[0],
    },
  };
}

export function sceneTables(exe, root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/010.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const byte = (offset) => overlay[offset] ?? 0;
  const copyright = COPYRIGHT.map((offset) => {
    const line = cString(byte, offset);
    if (!line.startsWith(PLACED)) throw new Error(`the title's copyright line at ${offset} does not start ${PLACED}: ${line}`);
    return line.slice(PLACED.length);
  });
  const menu = Array.from({ length: 10 }, (_, i) => {
    const at = MENU + i * 8;
    return { name: cString(byte, view.getUint32(at, true) - TITLE_OVERLAY), mode: byte(at + 4), twoPads: byte(at + 5) === 1, colour: byte(at + 6) };
  });
  return {
    powerOn: {
      next: exe.u8(0x80097f38),
      last: exe.u8(0x80097f39),
      attractOverlay: exe.u8(0x80097f3a),
      lastAttractOverlay: exe.u8(0x80097f3b),
      attractStep: exe.u8(0x80097f3e),
      intro: exe.u8(0x80097f20),
      intros: exe.u8(0x80097f1f),
      options: {
        difficulty: exe.u8(0x80097f06),
        rounds: exe.u8(0x80097f07),
        roundTime: exe.u8(0x80097f08),
        alwaysChip: exe.u8(0x80097f09),
        continueChooses: exe.u8(0x80097f0a),
        otherTitle: exe.u8(0x80097f0b),
        vibration: [exe.u8(0x80097f0c), exe.u8(0x80097f0d)],
        lastChoices: [exe.u8(0x80097f0e), exe.u8(0x80097f0f)],
        keepChoices: exe.u8(0x80097f19),
        modeSetting: exe.u8(0x80097f10),
        autoSave: exe.u8(0x80097f11),
        display: { x: exe.s8(0x80097f24), y: exe.s8(0x80097f25) },
      },
      keys: [0, 1].map((pad) => Array.from({ length: 8 }, (_, i) => exe.u8(0x80097f28 + pad * 8 + i))),
      ball: exe.u8(0x80097f26),
      theater: exe.u8(0x80097f27),
      picked: exe.u8(0x80097f40),
      toOptions: exe.u8(0x80097f41),
      earnedRoster: exe.u32(0x80097ef0),
      extraCostumes: exe.u32(0x80097ef4),
      versusPortraits: [exe.u8(0x80098106), exe.u8(0x80098107)],
      versusBackground: exe.s16(0x80098104),
      extraDrawn: exe.u8(0x80097f1e),
      plays: Array.from({ length: 22 }, (_, roster) => Array.from({ length: 4 }, (_, k) => exe.u16(0x8009804c + roster * 8 + k * 2))),
      endings: [exe.u32(0x80097ef8), exe.u32(0x80097efc)],
      newest: exe.u8(0x80097f12),
      playsSince: exe.u16(0x80097f1c),
      scheduleStep: exe.u8(0x80097f1a),
      scheduleStarted: exe.u8(0x80097f1b),
      ...bestRecords(exe),
    },
    /** The unlock schedule (`0x80098214`, fourteen steps of a kind and a value), and the endings that move it (`0x800b49dc` in Arcade's overlay). */
    schedule: Array.from({ length: 14 }, (_, k) => [exe.u8(0x80098214 + k * 2), exe.u8(0x80098215 + k * 2)]),
    endingSteps: new DataView(readFileSync(path.join(root, 'public/data/bns/005.bin')).buffer).getUint32(0x800b49dc - 0x800b0548, true),
    copyright,
    startLines: Array.from({ length: 4 }, (_, i) => ({ text: cString(exe.u8, exe.u32(START_LINES + i * 8)), half: exe.u32(START_LINES + i * 8 + 4) })),
    menu,
    keyBits: Array.from({ length: KEY_VALUES }, (_, i) => view.getUint16(KEY_BITS + i * 2, true)),
    fixedKeys: Array.from({ length: 8 }, (_, i) => view.getUint16(FIXED_KEYS + i * 2, true)),
    select: selectTables(exe, root),
    versus: versusTables(exe, root),
    vsSelect: vsSelectTables(exe, root),
    results: resultsTables(root),
    records: recordsTables(root),
    /** The attract demo's characters (`0x800e2a74` in the title's overlay; the attract overlay has the same). */
    intros: introTables(root),
    ogreChange: ogreChangeTables(root),
    options: optionsTables(overlay),
    theater: theaterTables(root),
    practice: practiceTables(root),
    demoFighters: Array.from(overlay.subarray(0x800e2a74 - TITLE_OVERLAY, 0x800e2a74 - TITLE_OVERLAY + 14)),
    movies: moviesTable(root),
    credits: creditsTable(root),
  };
}
