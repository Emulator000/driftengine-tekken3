/**
 * The input tables from the executable: per side, the pad bits of numpad 1 to 9 (0x80010738, nine
 * halfwords a side, 0x12 bytes apart); and the input sequences commands name, each a window then
 * steps ended by 0: by command 0xc00e on (63, pointers from 0x800954d0) and 0xc7ff on (41, from
 * 0x800955cc), and the two dashes' (0x8001006c forward, 0x80010078 back).
 */
const DIRECTIONS = 0x80010738;
const SEQUENCES_A = 0x800954d0;
const SEQUENCES_B = 0x800955cc;
const DASH_FORWARD = 0x8001006c;
const DASH_BACK = 0x80010078;

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
  };
}
