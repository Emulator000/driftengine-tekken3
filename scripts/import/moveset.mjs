/**
 * Movesets as the remake's typed movesets. A file's header
 * gives each section's offset: cancels at +4 (12 bytes each), moves at +8 (0x38 bytes each, their
 * count at +2), the move-id table at +0xc (4023 words), sound lists at +0x10 (halfwords), events
 * at +0x14 (four bytes each), the missing ids' bits at +0x18, motions at +0x1c and reaction tables
 * at +0x28. The sections follow one another in that order, so each ends where the next begins.
 * A move's motion word below 0x40000000 is an offset into its own motions, else into the common
 * moveset's past that; a move id's word likewise names an own or a common move by index, or no
 * move at all (0x3fffffff, only on an id flagged missing). A move's hit word names one of the 13
 * shared hit records by its key, or its moveset's own hit data four bytes past where it lies in the
 * hit area: four codes, a big-endian track word, then the track's points, five bytes each (x and y
 * in 13 bits and z in 14, each offset), up to where the next move's hit data starts. A fighter's
 * moveset also has its camera shots and scripts (`camera.mjs`); the common one has none.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { movesetCamera } from './camera.mjs';

export const SHARED = 0x40000000;
/** A move-id word naming no move: the id is one the character lacks. */
const NO_MOVE = 0x3fffffff;
const MOVE_BYTES = 0x38;
const MOVE_IDS = 4023;
/** The 13 reaction tables every moveset shares, eight bytes each: the key a move's word names, then the table. */
const SHARED_REACTIONS = 0x80017c10;
/** An event of this code adds its argument to its move's damage when the moveset loads. */
const EXTRA_DAMAGE = 0xb;

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Where the attract overlay is loaded and its intro's moveset lies, and the id the remake gives that moveset. */
const ATTRACT_OVERLAY = 0x800b8d58;
const INTRO_MOVESET = 0x800dd818;
export const INTRO_ID = 0x40;

/**
 * The moveset files: the disc's (BNS 280 + id, the empty 15 skipped), the attract intro's (its
 * overlay's own, as `intro`), the common one (BNS 279), and Kazuya's as 15 when `npm run extract`
 * built it (stage 6 moves its building into the importer).
 */
export function movesetFiles(root) {
  const bns = (index) => new Uint8Array(readFileSync(path.join(root, '.cache/bns', String(index).padStart(3, '0'))));
  const files = [];
  for (let id = 0; id <= 20; id += 1) {
    const bytes = bns(280 + id);
    if (bytes.length > 0) files.push({ name: String(id).padStart(2, '0'), id, bytes, common: false });
  }
  const extracted = path.join(root, 'public/data/manifest.json');
  const kazuya = existsSync(extracted) && JSON.parse(readFileSync(extracted, 'utf8')).kazuya === true;
  if (kazuya) files.push({ name: '15', id: 15, bytes: new Uint8Array(readFileSync(path.join(root, 'public/data/moves/15.bin'))), common: false });
  files.sort((a, b) => a.id - b.id);
  /* The attract intro's own moveset, in its overlay (BNS 0, loaded at 0x800b8d58): at 0x800dd818, its header's last offset its end. */
  const attract = bns(0);
  const at = INTRO_MOVESET - ATTRACT_OVERLAY;
  const end = new DataView(attract.buffer, attract.byteOffset + at).getUint32(0x34, true);
  files.push({ name: 'intro', id: INTRO_ID, bytes: attract.slice(at, at + end), common: false });
  files.push({ name: 'common', id: -1, bytes: bns(279), common: true });
  return { files, kazuya };
}

function moveWords(view) {
  const moves = view.getUint32(8, true);
  return Array.from({ length: view.getInt16(2, true) }, (_, i) => view.getUint32(moves + i * MOVE_BYTES, true));
}

/**
 * The motions moves use, numbered in offset order per file. The common moveset's are every
 * reference into it from any file, as a character may use a common motion no common move does.
 */
export function numberMotions(files) {
  const own = new Map();
  const common = new Set();
  for (const file of files) {
    const offsets = new Set();
    for (const word of moveWords(viewOf(file.bytes))) {
      if (file.common || word >= SHARED) common.add(word >= SHARED ? word - SHARED : word);
      else offsets.add(word);
    }
    if (!file.common) own.set(file.name, [...offsets].sort((a, b) => a - b));
  }
  own.set('common', [...common].sort((a, b) => a - b));
  const indices = new Map([...own].map(([name, list]) => [name, new Map(list.map((offset, i) => [offset, i]))]));
  return {
    offsets: (name) => own.get(name),
    ref(file, word) {
      const isCommon = file.common || word >= SHARED;
      return { common: isCommon, index: indices.get(isCommon ? 'common' : file.name).get(word >= SHARED ? word - SHARED : word) };
    },
  };
}

/** `file`'s moveset as the remake's JSON; `motions` from `numberMotions`, `files` to read a common motion's length. */
export function importMoveset(file, motions, files, exe) {
  const v = viewOf(file.bytes);
  const section = (field) => v.getUint32(field, true);
  const commonView = viewOf(files.find((f) => f.common).bytes);
  const sharedKeys = Array.from({ length: 13 }, (_, k) => exe.u16(SHARED_REACTIONS + k * 8));

  const cancels = [];
  for (let e = section(4); e < section(8); e += 0xc) {
    cancels.push({ command: v.getUint16(e, true), condition: v.getUint8(e + 2), test: v.getUint8(e + 3), param: v.getUint16(e + 4, true), target: v.getUint16(e + 6, true), type: v.getUint8(e + 8), from: v.getUint8(e + 9), to: v.getUint8(e + 10), start: v.getUint8(e + 11) });
  }
  const sounds = [];
  for (let e = section(0x10); e < section(0x14); e += 2) sounds.push(v.getUint16(e, true));
  const events = [];
  for (let e = section(0x14); e < section(0x18); e += 4) events.push({ frame: v.getInt16(e, true), code: v.getUint8(e + 3), arg: v.getUint8(e + 2) });

  /* The hit data the moves use, in the order it lies; each runs to the next. */
  const area = section(0x28);
  const areaEnd = section(0x2c);
  const used = [...new Set(moveWords(v).map((_, i) => v.getInt32(section(8) + i * MOVE_BYTES + 0x28, true)).filter((w) => w >= 0 && !sharedKeys.includes(w)).map((w) => w - 4))].sort((a, b) => a - b);
  const hitTables = used.map((offset, k) => {
    const at = area + offset;
    const end = k + 1 < used.length ? area + used[k + 1] : areaEnd;
    const points = [];
    for (let p = at + 6; p + 5 <= end; p += 5) {
      const low = v.getUint32(p, true);
      const high = v.getUint32(p + 1, true);
      points.push((low & 0x1fff) - 0x1000, ((low >>> 13) & 0x1fff) - 0x1000, ((high >>> 18) & 0x3fff) - 0x2000);
    }
    return { offset, codes: [0, 1, 2, 3].map((i) => v.getUint8(at + i)), track: { word: (v.getUint8(at + 4) << 8) | v.getUint8(at + 5), points } };
  });
  const tableIndex = new Map(used.map((offset, k) => [offset + 4, k]));

  const moves = moveWords(v).map((word, i) => {
    const m = section(8) + i * MOVE_BYTES;
    const motion = motions.ref(file, word);
    const offset = word >= SHARED ? word - SHARED : word;
    const frames = motion.common ? commonView.getUint8(commonView.getUint32(0x1c, true) + offset) : v.getUint8(section(0x1c) + offset);
    const eventIndex = v.getInt32(m + 0x20, true);
    let damage = v.getInt16(m + 0x14, true);
    if (eventIndex >= 0) {
      for (let k = eventIndex; events[k].frame !== 0; k += 1) if (events[k].code === EXTRA_DAMAGE) damage += events[k].arg;
    }
    damage &= 0xffff;
    const soundIndex = v.getInt32(m + 0x1c, true);
    const reactionWord = v.getInt32(m + 0x28, true);
    const shared = sharedKeys.indexOf(reactionWord);
    return {
      motion,
      flags: v.getUint32(m + 4, true),
      hitLevel: v.getUint32(m + 8, true),
      cancels: v.getUint32(m + 0xc, true),
      next: v.getInt16(m + 0x10, true),
      facingOffset: v.getInt16(m + 0x12, true),
      damage: damage & 0x3fff,
      damageFlags: damage >> 14,
      stepSpeed: v.getInt16(m + 0x16, true),
      length: frames,
      stepWindow: { first: v.getUint8(m + 0x19), last: v.getUint8(m + 0x1a) },
      endFrame: v.getUint8(m + 0x1b),
      sounds: soundIndex < 0 ? -1 : soundIndex,
      events: eventIndex < 0 ? -1 : eventIndex,
      hitFlags: v.getUint32(m + 0x24, true),
      hit: reactionWord < 0 ? null : shared >= 0 ? { shared } : { table: tableIndex.get(reactionWord) },
      hitStun: v.getUint8(m + 0x2c),
      activeWindow: { first: v.getUint8(m + 0x2d), last: v.getUint8(m + 0x2e) },
      pushShape: v.getUint16(m + 0x30, true),
      throwReaction: v.getUint16(m + 0x32, true),
      reactionKind: v.getUint16(m + 0x34, true),
    };
  });

  const moveIds = [];
  const missing = [];
  if (!file.common) {
    for (let id = 0; id < MOVE_IDS; id += 1) {
      const word = v.getUint32(section(0xc) + id * 4, true);
      moveIds.push(word === NO_MOVE ? null : word < SHARED ? { common: false, index: word } : { common: true, index: word - SHARED });
      if (((v.getUint16(section(0x18) + (id >> 4) * 2, true) >> (id & 15)) & 1) === 1) missing.push(id);
    }
  }
  const camera = file.common ? { shots: [], scripts: [] } : movesetCamera(v, section(0x20), section(0x24));
  return { moves, cancels, moveIds, missing, sounds, events, hitTables, ...camera };
}
