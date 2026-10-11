/**
 * The game's math tables. `sine` is the sine of 4096 steps a turn in 4.12 fixed point, a quarter
 * turn longer so a cosine reads it a quarter on. `atan[i]` plus half of `i` is the angle whose
 * tangent is i/1024, in 4096ths of a turn. `roots` holds the square roots the distances are taken
 * by, from a value's top bits; `negativeRoots` is what the original reads for a negative value,
 * which lands before its table (a squared distance past 2^31 wraps negative). The geometry library's
 * square root has its own copy of the roots, alike, and reads its own memory before them for a
 * negative value (`libraryNegativeRoots`).
 */
export interface MathTables {
  readonly sine: Int16Array;
  readonly atan: Uint8Array;
  readonly roots: Int16Array;
  readonly negativeRoots: Int16Array;
  readonly libraryNegativeRoots: Int16Array;
}
