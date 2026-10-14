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

/** The stages whose archive is in the program instead (by stage number), its texture pages compressed. */
export const PROGRAM_STAGES = new Map([[13, 0x283abc]]);

/** Each stage's archive in the joined data, by its stage number: a scenery model, then its texture pages. */
export const STAGE_ARCHIVES = [0x11d663c, 0x125ab40, 0x12d54d8, 0x1338768, 0x13817fc, 0x13ce3c0, 0x142d808, 0x14652a4, 0x14917f4, 0x1521630, 0x15570b8, 0x15c7a34, 0x15f6f08];

/**
 * The panoramas the stages draw behind their scenery, by stage number: a run of the stage's
 * textures (counted through its archive's texture pages in order), each 64 texels square, laid
 * `columns` a row, and how far down the picture its horizon lies (a share of its height).
 */
export const STAGE_PANORAMAS = new Map([
  [1, { first: 125, count: 80, columns: 16, horizon: 0.9 }],
  [3, { first: 90, count: 32, columns: 8, horizon: 1 }],
  [5, { first: 147, count: 24, columns: 8, horizon: 1 }],
  [8, { first: 146, count: 96, columns: 16, horizon: 0.9 }],
  [9, { first: 68, count: 30, columns: 10, horizon: 0.95 }],
  [10, { first: 139, count: 80, columns: 16, horizon: 0.95 }],
  [11, { first: 17, count: 72, columns: 12, horizon: 0.45 }],
  [12, { first: 76, count: 32, columns: 8, horizon: 0.85 }],
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
 * (0 x, 1 y, 2 z). `shown` 'fighting' keeps a piece away until the round's fight begins.
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
        shown: 'fighting',
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
