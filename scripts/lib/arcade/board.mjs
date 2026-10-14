/**
 * The Tekken 3 arcade board this reads (Namco System 12, the one revision supported): the data
 * and program chips of a dump of it, recognised by their SHA-256 whatever their files are called,
 * and where its stages and their moving pieces lie in their joined data.
 *
 * Each sits on a 16-bit bus of two 8-bit chips a pair, one the even bytes and one the odd; the
 * three data pairs end to end make the joined data, 24 MB, and the program pair the program, 4 MB.
 */
import { createHash } from 'node:crypto';

/** The supported revision's data chips: each one's pair, its half (0 even bytes, 1 odd), and its SHA-256, for identification only. */
export const DATA_CHIPS = [
  { pair: 0, half: 0, sha256: '1a7f418f397907650725ab3a5bddba520a1d647baac79a8c69d6ecc645d85903' },
  { pair: 0, half: 1, sha256: 'aac6c97d7f0546c776af8710745b85b01dcd8be7d6b35f1eae85db76feeff0d1' },
  { pair: 1, half: 0, sha256: '8f7963544665ea3b707f218433252c5aaf1550b4297b2e212b3d2478371ee2db' },
  { pair: 1, half: 1, sha256: 'b237d5ceb94b456ca14b390f1969729f2ea1c6b55caaebef11c859a9311eb6cd' },
  { pair: 2, half: 0, sha256: 'f5c9aa890ab7d03f3db72512eab4dfe4223d1f2da3b37608805eebf6fe0abeed' },
  { pair: 2, half: 1, sha256: 'e7ebb77dd5032c53d1c4a7148824ac7ab41c5d8123953bcf8c172f60f86f8c9f' },
];
export const PAIRS = 3;
/** The program chips, a pair (pair 0), each 2 MB. */
export const PROGRAM_CHIPS = [
  { pair: 0, half: 0, sha256: '36d34d98777bb0167c9b42e05432d95e36b97e91d6c44b4f5f76ba5d41b1d62c' },
  { pair: 0, half: 1, sha256: 'f48174343982f3c3b8930b991c267bdf9a8d6136dc2bd6778717a1af2cd9d12d' },
];
export const PROGRAM_CHIP_SIZE = 2 << 20;
/** Each data chip's size, and so each pair's half. */
export const CHIP_SIZE = 4 << 20;

/** The stages whose archive is in the program instead (by stage number), its texture pages compressed: the park. */
export const PROGRAM_STAGES = new Map([[7, 0x283abc]]);

/** Each stage's archive in the joined data, by its stage number (the park's is the program's): a scenery model, then its texture pages. */
export const STAGE_ARCHIVES = new Map([
  [0, 0x11d663c],
  [1, 0x125ab40],
  [2, 0x12d54d8],
  [3, 0x1338768],
  [4, 0x13817fc],
  [5, 0x13ce3c0],
  [6, 0x142d808],
  [8, 0x14917f4],
  [9, 0x1521630],
  [10, 0x15570b8],
  [11, 0x15c7a34],
  [12, 0x15f6f08],
]);

/** The game's code in the program, compressed, and where it runs from. */
export const PROGRAM_CODE = { at: 0x45df8, base: 0x8007e684 };

/**
 * The fighters' accessories in the code (records 18 to 23 of a fighter's model): a byte each, six a
 * fighter from `shown` + 18 (0 not drawn, 1 drawn as stored, more the index of the turn its points
 * are given as the fighter loads, three 16-bit angles 8 bytes apart from `turns`), and a word each,
 * six a fighter from `springs`, its spring's halfwords: the three angles added to its rest, the row
 * of `axes` (six signed bytes a row) its angles are taken with, the frames its tip is followed over,
 * how much of its last direction it keeps, gravity's pull, its reach, gravity's slant, its kind
 * (1: held off a point on another joint, its joint, the point, and the row whose last two bytes
 * weigh the point's aim; 2: its tip kept out of a round about a line along another joint's x, its
 * joint, the line's place and the radius). `none` is the spring of one that does not swing; fighter
 * 26's swings are held within `limits`' two halfwords (the most, the least).
 */
export const ACCESSORY_TABLES = { shown: 0x801fd2e6, turns: 0x801fd3e4, springs: 0x801fdc88, axes: 0x801fd170, none: 0x801fd4d4, limits: new Map([[26, 0x801fd2f0]]) };

/**
 * Where the code keeps each stage's background, in its running addresses: per stage, 20 bytes of
 * its panorama (its tiles across and down, its tile words', palettes' and mask's tables, its top's
 * offset and the degrees the picture's width spans), a halfword of how far its top moves with the
 * camera's pitch, and 12 bytes of colours (a filled tile's, the one above it, the one below it, each
 * with a byte saying whether it is drawn). Stages 0 to 12 have one.
 */
export const BACKGROUND_TABLES = { layouts: 0x801749a0, pitch: 0x80174aa4, colours: 0x80174ac0, stages: 13 };

/**
 * What the code does for some stages beyond their tables: the highest and lowest their panorama's
 * top stands (in the picture's 480 lines), stage 3's sky a gradient in place of its tiles, stage
 * 5's fourth row drawn upside down, and stage 6 one colour over the whole picture.
 */
export const BACKGROUND_RULES = new Map([
  [0, { most: 0 }],
  [3, { most: 0, gradient: { from: [0, 0x14, 0x66], to: [0, 0, 0], lines: 0xc0 } }],
  [5, { most: 0, flipped: 3 }],
  [6, { whole: true }],
  [11, { most: 0, least: -0xc0 }],
]);

/** Cells of a stage's model the game leaves out of the scenery, by stage number. */
export const STAGE_LEFT_OUT = new Map([
  [0, [198, 199, 216]],
  [5, [83, 99, 107]],
]);

/**
 * The stages' moving pieces, by stage number. A piece is models from the program (its `parts`),
 * drawing from the texture chains `textures` (start and end in the program); or a `flipbook`: the
 * stage's own polygons showing the texture most like a run of frames in the program, drawn through
 * those frames in turn, `fields` each.
 *
 * A piece stands at `at` in the scenery (model units) turned by `angles` (pitch, yaw, roll,
 * 4096ths), its yaw turning `spin` a field (back where it began every `wrap` fields, where it has one); each of its `sway` moves one of its height, pitch, yaw
 * or roll `step` a field, the other way every `period` fields (the first time after `start`). A
 * part stands at `at` in the piece, turned by `angles`, and turns `spin` a field about one axis
 * (0 x, 1 y, 2 z).
 */
export const STAGE_OBJECTS = new Map([
  [
    3,
    [
      { name: 'carousel', textures: [[0x2811c0, 0x2831e4]], parts: [{ model: 0x2831e4 }], at: [0, -300, 3100], angles: [0, 0x955, 0], spin: -5, wrap: 136 },
      { name: 'canopy', textures: [[0x2811c0, 0x2831e4]], parts: [{ model: 0x2836e4 }, { model: 0x28383c, angles: [0, 0x800, 0] }], at: [0, -300, 3100] },
      { name: 'beams', textures: [[0x2811c0, 0x2831e4]], parts: [{ model: 0x283994 }], at: [0, 0, 0], angles: [0, 0x800, 0] },
    ],
  ],
  [6, [{ name: 'torches', flipbook: [0x27329c, 0x27b6a0], fields: 4 }]],
  [
    11,
    [
      {
        name: 'helicopter',
        textures: [[0x27b6c8, 0x27facc]],
        parts: [{ model: 0x27facc }, { model: 0x280dbc, at: [0, -300, 0], spin: { axis: 1, rate: -0x29f } }],
        at: [0, -400, 4200],
        angles: [-159, 0x71c, 0],
        sway: [
          { channel: 'height', step: -1, period: 64, start: 32 },
          { channel: 'yaw', step: -0.5, period: 256, start: 128 },
          { channel: 'roll', step: -1, period: 64, start: 32 },
        ],
      },
    ],
  ],
  [12, [{ name: 'torches', flipbook: [0x27329c, 0x27b6a0], fields: 4 }]],
]);

/** The archive at `at` in the joined data, as far as its last member ends. */
export function archiveAt(data, at) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(at, true);
  const last = at + 4 + (count - 1) * 8;
  return data.subarray(at, at + view.getUint32(last, true) + view.getUint32(last + 4, true));
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The data chips among `files` (`{ name, bytes }`): by pair and half, the bytes of each one found,
 * and the names of the files that are none of them.
 */
export function identifyChips(files, chips = DATA_CHIPS) {
  const found = new Map();
  const others = [];
  for (const { name, bytes } of files) {
    const hash = sha256(bytes);
    const chip = chips.find((c) => c.sha256 === hash);
    if (chip === undefined) others.push(name);
    else found.set(`${chip.pair}.${chip.half}`, bytes);
  }
  const missing = chips.filter((c) => !found.has(`${c.pair}.${c.half}`)).map((c) => ({ pair: c.pair, half: c.half }));
  return { found, missing, others };
}

/** One pair's 16-bit data: the even bytes from one chip, the odd from the other. */
export function joinPair(even, odd) {
  if (even.length !== odd.length) throw new Error(`a pair's chips differ in size (${even.length} and ${odd.length} bytes)`);
  const out = new Uint8Array(even.length * 2);
  for (let i = 0; i < even.length; i += 1) {
    out[i * 2] = even[i];
    out[i * 2 + 1] = odd[i];
  }
  return out;
}

/** The joined data of every pair, end to end, from what `identifyChips` found. */
export function joinData(found, pairs = PAIRS) {
  const parts = [];
  for (let pair = 0; pair < pairs; pair += 1) parts.push(joinPair(found.get(`${pair}.0`), found.get(`${pair}.1`)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
