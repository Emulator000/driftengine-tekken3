/**
 * The fight's sound tables, from the executable.
 *
 * A sound code is a halfword: its top two bits the bank (1 and 2 the effects' two, 3 the fighter's
 * own), the voice in bits 10 to 13, the volume in bits 6 to 9 (an index into sixteen volumes at
 * 0x800278fc), the program in bits 4 and 5 and the tone in bits 0 to 3. Effects are codes by number
 * (0x80097050, up to the counters at 0x800971dc). Mokujin plays his own code for some: pairs of
 * effect number and code from 0x8001af7c, -1 ending them.
 *
 * Each sound character has a record of 0x18 bytes from 0x8001ad54: its lines (counts for the four
 * kinds 2 to 5, then the codes kind after kind), its grunts (a count, then codes), its cries (a
 * count for light blows and one for heavy, then the codes), the frames a grunt waits after another
 * (`+0xc`) and the line a script's event 1 plays (`+0x12`). Kazuya's (0x17) is built from his
 * Tekken 4 voice (`public/data/fighters/52.voice`: his bank's body size, the grunt wait, then the
 * offsets of his lists), the rest of it Heihachi's (14).
 *
 * The hit sounds: two tables of ten halfwords (0x8001a6fc for rosters 5, 7, 10 and 0x12, 0x8001a710
 * for the rest), Mokujin's five (0x8001a6f0), and the three an event 3 picks from (0x8001ad4c). The
 * sound scripts a move starts (470 pointers from 0x800971f8), each words of frame (bits 0 to 11),
 * kind (12 to 15) and code (the high half), ending at frame 0. The announcer's round calls by round
 * (0x8001a3b8). Each sound character's bank (0x80027890), 0xff for none.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const EFFECTS = 0x80097050;
const EFFECT_COUNT = (0x800971dc - EFFECTS) / 2;
const VOLUMES = 0x800278fc;
const MOKUJIN_SOUNDS = 0x8001af7c;
const RECORDS = 0x8001ad54;
const CHARACTERS = 0x17;
const KAZUYA = 0x17;
const HEIHACHI = 14;
const HIT_SOUNDS = 0x8001a6fc;
const OTHER_HIT_SOUNDS = 0x8001a710;
const MOKUJIN_HITS = 0x8001a6f0;
const EVENT_SOUNDS = 0x8001ad4c;
const SCRIPTS = 0x800971f8;
const SCRIPT_COUNT = 470;
const ROUND_CALLS = 0x8001a3b8;
/** Each sound character's bank (0x80027890; 0xff none), Kazuya's his own. */
const BANK_OF = 0x80027890;
const KAZUYA_BANK = 0x15;

const halves = (exe, at, count) => Array.from({ length: count }, (_, i) => exe.s16(at + i * 2));

/** A voice record's lists read through `halfAt`, an address's halfword. */
function character(halfAt, lines, grunts, cries, gruntWait, eventLine) {
  const counts = [0, 1, 2, 3].map((k) => halfAt(lines + k * 2));
  const lineCount = counts.reduce((a, b) => a + Math.max(0, b), 0);
  const cryCounts = [halfAt(cries), halfAt(cries + 2)];
  return {
    lines: { counts, codes: Array.from({ length: lineCount }, (_, i) => halfAt(lines + (4 + i) * 2)) },
    grunts: Array.from({ length: Math.max(0, halfAt(grunts)) }, (_, i) => halfAt(grunts + (1 + i) * 2)),
    cries: { light: cryCounts[0], heavy: cryCounts[1], codes: Array.from({ length: Math.max(0, cryCounts[0]) + Math.max(0, cryCounts[1]), }, (_, i) => halfAt(cries + (2 + i) * 2)) },
    gruntWait,
    eventLine,
  };
}

export function soundTables(exe, root) {
  const characters = Array.from({ length: CHARACTERS }, (_, c) => {
    const record = RECORDS + c * 0x18;
    return character((a) => exe.s16(a), exe.u32(record), exe.u32(record + 4), exe.u32(record + 8), exe.s16(record + 0xc), exe.s16(record + 0x12));
  });
  const voicePath = path.join(root, 'public/data/fighters/52.voice');
  if (existsSync(voicePath)) {
    const voice = new Uint8Array(readFileSync(voicePath));
    const view = new DataView(voice.buffer, voice.byteOffset, voice.byteLength);
    const halfAt = (offset) => view.getInt16(offset, true);
    const heihachi = RECORDS + HEIHACHI * 0x18;
    characters[KAZUYA] = character(halfAt, view.getUint16(6, true), view.getUint16(8, true), view.getUint16(10, true), view.getUint16(4, true), exe.s16(heihachi + 0x12));
  }
  const mokujin = [];
  for (let at = MOKUJIN_SOUNDS; exe.s16(at) !== -1; at += 4) mokujin.push({ effect: exe.s16(at), code: exe.s16(at + 2) });
  return {
    effects: Array.from({ length: EFFECT_COUNT }, (_, i) => exe.u16(EFFECTS + i * 2)),
    volumes: Array.from({ length: 16 }, (_, i) => exe.u8(VOLUMES + i)),
    mokujin,
    characters,
    hitSounds: halves(exe, HIT_SOUNDS, 10),
    otherHitSounds: halves(exe, OTHER_HIT_SOUNDS, 10),
    mokujinHits: halves(exe, MOKUJIN_HITS, 5),
    eventSounds: halves(exe, EVENT_SOUNDS, 3),
    scripts: Array.from({ length: SCRIPT_COUNT }, (_, i) => {
      const words = [];
      for (let at = exe.u32(SCRIPTS + i * 4); (exe.u32(at) & 0xfff) !== 0; at += 4) {
        const word = exe.u32(at);
        words.push({ frame: word & 0xfff, kind: (word >>> 12) & 0xf, code: word >>> 16 });
      }
      return words;
    }),
    roundCalls: Array.from({ length: 11 }, (_, i) => exe.u16(ROUND_CALLS + i * 2)),
    banks: Array.from({ length: CHARACTERS + 1 }, (_, sound) => (sound === KAZUYA ? KAZUYA_BANK : exe.u8(BANK_OF + sound))),
  };
}
