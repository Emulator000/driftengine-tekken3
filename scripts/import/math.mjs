/**
 * The math tables from the executable: the sine at 0x8001e8c4, 5120 halfwords (its
 * cosine table at 0x8001f0c4 is the same one a quarter on); the arctangent at 0x800210c8, 1025
 * bytes; the roots at 0x8004af40, 192 halfwords. A negative value's root reads 192 halfwords from
 * 640 bytes before the roots, the code ahead of them. The geometry library keeps its own copy of the
 * roots (0x80098d08, the same values) for its square root, which reads its own 640 bytes before for
 * a negative value.
 */
const SINE = 0x8001e8c4;
const ATAN = 0x800210c8;
const ROOTS = 0x8004af40;
const LIBRARY_ROOTS = 0x80098d08;

const halves = (exe, address, count) => Array.from({ length: count }, (_, i) => exe.s16(address + i * 2));

export function mathTables(exe) {
  return {
    sine: halves(exe, SINE, 5120),
    atan: Array.from({ length: 1025 }, (_, i) => exe.u8(ATAN + i)),
    roots: halves(exe, ROOTS, 192),
    negativeRoots: halves(exe, ROOTS - 640, 192),
    libraryNegativeRoots: halves(exe, LIBRARY_ROOTS - 640, 192),
  };
}
