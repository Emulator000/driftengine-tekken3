/**
 * The fight camera's data. From the executable: the shots a move's camera byte below 0x2b picks
 * from (eight bytes an entry from 0x80098370: whether the shot keeps its side, the cumulative odds
 * out of 0x1000, the shot), the built-in shots (0x14-byte rows from 0x80023f18: length, the length
 * of handing back, four pitches and four yaws) and which row each of the 30 shot numbers plays
 * (0x80024170, the row plus one), the scenes a fighter's state calls for (the calls, six bytes from
 * 0x800242a4: the other fighter's moveset and move id and the list; the lists, a pointer and a
 * count each from 0x8002428c, of 0x14-byte entries: odds, then a scene per kind), the scenes
 * themselves (0x20 bytes: kind, frames held, length, closing, the distances a pull-in runs from and
 * to, four pitches and four yaws), the ten opening sweeps (an
 * offset each, 0x80098508), the knockout camera's placings (three halfwords each at 0x8001df54,
 * 0x8001df5c and 0x8001df64) and the attract mode's four shots (0x800242bc).
 *
 * A shot that is no built-in one reads its handing-back length before the built-in rows, as if
 * from row -1 (none, or a number naming nothing) or row -2 (a script); those two halfwords are
 * imported as such.
 *
 * The scene lists' odds are made cumulative and scaled to 0x1000 once at boot;
 * they are imported so.
 *
 * From a moveset: its own shots for camera bytes from 0x2b (the header's `+0x20` section) and the
 * camera scripts they name (an offset into the `+0x24` section, as the low half of a shot word
 * with the top bit set). A script is a side code, then a length in frames and a channel count in
 * one halfword, then each channel's segments: a halfword each (a type in bits 10 and 11, a length
 * below, in a channel's first the count of further segments above bit 12) and its data.
 */
const MOVE_SHOTS = 0x80098370;
/** The last entry the executable's move shots hold (0x25, all zero); past it lie the scene lists. */
const MOVE_SHOT_ENTRIES = 0x26;
const SHOT_TABLE = 0x80023f18;
const SHOT_ROWS = 30;
const SHOT_KINDS = 0x80024170;
const SCENE_LISTS = 0x8002428c;
const SCENE_CALLS = 0x800242a4;
const ATTRACT_SHOTS = 0x800242bc;
/** The attract mode's orbit: its heights (eight 18-bit pitches) and its two speeds. */
const ORBIT_PITCHES = 0x80098550;
const ORBIT_SPEEDS = 0x80098560;
const OPENING_SWEEPS = 0x80098508;
const KNOCKOUT_AHEAD = 0x8001df54;
const KNOCKOUT_OUT = 0x8001df5c;
const KNOCKOUT_HEIGHT = 0x8001df64;
const SCENE_ENTRY_BYTES = 0x14;

const signed = (v) => v | 0;
const halves = (exe, at, count) => Array.from({ length: count }, (_, i) => exe.s16(at + i * 2));

export function cameraTables(exe) {
  const moveShots = [null];
  for (let i = 1; i < MOVE_SHOT_ENTRIES; i += 1) {
    const at = MOVE_SHOTS + i * 8;
    const shot = exe.u32(at + 4);
    if (shot >= 0x80000000 && shot !== 0xffffffff) throw new Error(`the executable's move shot ${i} names a script`);
    moveShots.push({ kind: exe.s16(at), odds: exe.u16(at + 2), shot: signed(shot) });
  }
  const shots = Array.from({ length: SHOT_ROWS }, (_, row) => {
    const at = SHOT_TABLE + row * 0x14;
    return { length: exe.s16(at), exit: exe.s16(at + 2), pitches: halves(exe, at + 4, 4), yaws: halves(exe, at + 0xc, 4) };
  });

  const scenes = [];
  const sceneIndex = new Map();
  const sceneOf = (address) => {
    if (!sceneIndex.has(address)) {
      sceneIndex.set(address, scenes.length);
      scenes.push({
        kind: exe.s16(address),
        hold: exe.s16(address + 2),
        length: exe.s16(address + 4),
        close: exe.s16(address + 6),
        reach: [signed(exe.u32(address + 8)), signed(exe.u32(address + 0xc))],
        pitches: halves(exe, address + 0x10, 4),
        yaws: halves(exe, address + 0x18, 4),
      });
    }
    return sceneIndex.get(address);
  };
  const sceneLists = [];
  for (let pair = SCENE_LISTS; pair < SCENE_CALLS; pair += 8) {
    const list = exe.u32(pair);
    const count = exe.u32(pair + 4);
    const raw = Array.from({ length: count }, (_, i) => exe.s16(list + i * SCENE_ENTRY_BYTES));
    const total = raw.reduce((a, b) => a + b, 0);
    let sum = 0;
    sceneLists.push(
      raw.map((odds, i) => {
        sum = ((sum + odds) << 16) >> 16;
        const at = list + i * SCENE_ENTRY_BYTES;
        return { odds: (Math.trunc((sum << 12) / total) << 16) >> 16, scenes: [0, 1, 2, 3].map((kind) => sceneOf(exe.u32(at + 4 + kind * 4))) };
      }),
    );
  }
  const sceneCalls = Array.from({ length: 4 }, (_, i) => {
    const at = SCENE_CALLS + i * 6;
    return { character: exe.s16(at), moveId: exe.s16(at + 2), list: exe.s16(at + 4) - 300 };
  });
  for (const call of sceneCalls) if (call.list < 0 || call.list >= sceneLists.length) throw new Error(`a scene call names list ${call.list}`);

  return {
    moveShots,
    shots,
    shotRows: halves(exe, SHOT_KINDS, SHOT_ROWS),
    noShotExit: exe.s16(SHOT_TABLE - 0x14 + 2),
    scriptExit: exe.s16(SHOT_TABLE - 0x28 + 2),
    sceneLists,
    sceneCalls,
    scenes,
    openingSweeps: Array.from({ length: 10 }, (_, i) => halves(exe, OPENING_SWEEPS + i * 6, 3)),
    knockout: { ahead: halves(exe, KNOCKOUT_AHEAD, 3), out: halves(exe, KNOCKOUT_OUT, 3), heights: halves(exe, KNOCKOUT_HEIGHT, 3) },
    attractShots: Array.from({ length: 4 }, (_, i) => exe.u16(ATTRACT_SHOTS + i * 2)),
    orbitPitches: Array.from({ length: 8 }, (_, i) => exe.s16(ORBIT_PITCHES + i * 2)),
    orbitSpeeds: Array.from({ length: 2 }, (_, i) => exe.s16(ORBIT_SPEEDS + i * 2)),
  };
}

/** A shot word: a script of the moveset by its offset, or the number itself. */
const isScript = (word) => word >= 0x80000000 && word !== 0xffffffff;

/**
 * A moveset's own shots and the scripts they name, numbered in offset order. `view` reads the
 * file; `shots` and `scripts` are where its two sections start, `end` where the scripts' ends.
 */
export function movesetCamera(view, shots, scripts) {
  const words = [];
  for (let at = shots; at < scripts; at += 8) words.push({ kind: view.getInt16(at, true), odds: view.getUint16(at + 2, true), word: view.getUint32(at + 4, true) });
  const offsets = [...new Set(words.filter((w) => isScript(w.word)).map((w) => w.word & 0xffff))].sort((a, b) => a - b);
  const index = new Map(offsets.map((offset, i) => [offset, i]));
  return {
    shots: words.map(({ kind, odds, word }) => ({ kind, odds, shot: isScript(word) ? { script: index.get(word & 0xffff) } : signed(word) })),
    scripts: offsets.map((offset) => cameraScript(view, scripts + offset)),
  };
}

function cameraScript(view, at) {
  const s16 = (o) => view.getInt16(o, true);
  const u16 = (o) => view.getUint16(o, true);
  const head = u16(at + 2);
  const frames = head & 0x3ff;
  let p = at + 4;
  const channels = [];
  for (let c = 0; c < head >> 10; c += 1) {
    const more = u16(p) >> 12;
    const segments = [];
    for (let k = 0; k <= more; k += 1) {
      const segment = s16(p);
      p += 2;
      const type = (segment >> 10) & 3;
      const length = segment & 0x3ff;
      if (type === 0) {
        segments.push({ kind: 'constant', length, value: s16(p) });
        p += 2;
      } else if (type === 1) {
        segments.push({ kind: 'linear', length, start: u16(p), slope: s16(p + 2) });
        p += 4;
      } else if (type === 2) {
        if (length === 0) throw new Error(`camera script at 0x${at.toString(16)}: a keyed segment with no keys`);
        const entries = Array.from({ length: length - 1 }, (_, i) => s16(p + 2 + i * 2));
        segments.push({ kind: 'keys', start: s16(p), steps: entries.map((e) => (e >> 5) << 4), spans: entries.map((e) => (e & 0x1f) + 1) });
        p += length * 2;
      } else {
        segments.push({ kind: 'samples', values: Array.from({ length }, (_, i) => s16(p + i * 2)) });
        p += length * 2;
      }
    }
    channels.push(segments);
  }
  return { side: u16(at), frames, channels };
}
