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
 * line between the portraits and the stage's line (their formats' leading colour, font and place
 * codes dropped); from the executable each background's band (`0x80022694` colour, `0x800226b0`
 * width) and archive (`0x80022690`, a logical file).
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
    demoStage: text(0x800b0718),
    bands: [0, 1].map((band) => ({ colour: exe.u32(0x80022694 + band * 4), width: exe.u16(0x800226b0 + band * 2) })),
    backgrounds: [0, 1].map((picture) => exe.u16(0x80022690 + picture * 2)),
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
    records: recordsTables(root),
    /** The attract demo's characters (`0x800e2a74` in the title's overlay; the attract overlay has the same). */
    intros: introTables(root),
    ogreChange: ogreChangeTables(root),
    demoFighters: Array.from(overlay.subarray(0x800e2a74 - TITLE_OVERLAY, 0x800e2a74 - TITLE_OVERLAY + 14)),
    movies: moviesTable(root),
    credits: creditsTable(root),
  };
}
