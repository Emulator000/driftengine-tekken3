/**
 * The input tables from the executable: per side, the pad bits of numpad 1 to 9 (0x80010738, nine
 * halfwords a side, 0x12 bytes apart); and the input sequences commands name, each a window then
 * steps ended by 0: by command 0xc00e on (63, pointers from 0x800954d0) and 0xc7ff on (41, from
 * 0x800955cc), and the two dashes' (0x8001006c forward, 0x80010078 back). And the pads'
 * vibration: each of its 28 patterns' channel (0x80010050, a byte each) and its two motors' steps
 * (0x80095334, a pointer to the small motor's and one to the large motor's, 8 bytes a pattern; each
 * step a halfword: whether another follows in its top nibble (1), its level, its fields), and the
 * small motor's duty by level (0x80095414, a byte each: the fields of eight it turns).
 */
const DIRECTIONS = 0x80010738;
const SEQUENCES_A = 0x800954d0;
const SEQUENCES_B = 0x800955cc;
const DASH_FORWARD = 0x8001006c;
const DASH_BACK = 0x80010078;
const VIBRATION = { channels: 0x80010050, patterns: 0x80095334, duty: 0x80095414, count: 28 };

/** A motor's steps: its halfwords up to the one no other follows. */
function steps(exe, at) {
  const words = [];
  for (let i = 0; ; i += 1) {
    const word = exe.u16(at + i * 2);
    words.push(word);
    if (word >> 12 !== 1) return words;
  }
}

/** A sequence's halfwords: its window, its steps, and the 0 that ends it. */
function sequence(exe, at) {
  const words = [exe.u16(at)];
  for (let i = 1; ; i += 1) {
    const word = exe.u16(at + i * 2);
    words.push(word);
    if (word === 0) return words;
  }
}

export function inputTables(exe) {
  return {
    directions: [0, 1].map((side) => Array.from({ length: 9 }, (_, d) => exe.u16(DIRECTIONS + side * 0x12 + d * 2))),
    sequencesA: Array.from({ length: 0x3f }, (_, k) => sequence(exe, exe.u32(SEQUENCES_A + k * 4))),
    sequencesB: Array.from({ length: 0x29 }, (_, k) => sequence(exe, exe.u32(SEQUENCES_B + k * 4))),
    dashForward: sequence(exe, DASH_FORWARD),
    dashBack: sequence(exe, DASH_BACK),
    vibration: {
      channels: Array.from({ length: VIBRATION.count }, (_, k) => exe.u8(VIBRATION.channels + k)),
      small: Array.from({ length: VIBRATION.count }, (_, k) => steps(exe, exe.u32(VIBRATION.patterns + k * 8))),
      large: Array.from({ length: VIBRATION.count }, (_, k) => steps(exe, exe.u32(VIBRATION.patterns + k * 8 + 4))),
      duty: Array.from({ length: 16 }, (_, level) => exe.u8(VIBRATION.duty + level)),
    },
  };
}
