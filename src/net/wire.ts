/**
 * A pad's word as an online match sends it: the 16 bits the game reads a pad by, two bytes little
 * end first. Every word is one a pad could give (the game masks what it does not read), so none is
 * refused. A packet carries the field's word and the `REDUNDANCY` before it, so a run of lost packets
 * is made up by the next one without asking again.
 */

/** Bytes a pad's word takes. */
export const INPUT_BYTES = 2;

/**
 * Words each packet repeats: further back than two peers each waiting on the other can be apart
 * (the input delay and the rollback window, twice), so the one behind always finds the word it waits
 * for in the next packet that arrives.
 */
export const REDUNDANCY = 32;

/** A pad's left and right. */
const LEFT = 0x8000;
const RIGHT = 0x2000;

/**
 * A pad's word as the game takes it from a player who sees the fight mirrored: the stick's left and
 * right swapped (left on the screen is the game's right), its up and down and every button as they
 * are, as a move is a button's whichever side the fighter is seen from.
 */
export function mirroredStick(word: number): number {
  return (word & ~(LEFT | RIGHT)) | ((word & LEFT) !== 0 ? RIGHT : 0) | ((word & RIGHT) !== 0 ? LEFT : 0);
}

export function writeWord(into: Uint8Array, word: number, at = 0): void {
  into[at] = word & 0xff;
  into[at + 1] = (word >>> 8) & 0xff;
}

export function readWord(from: Uint8Array, at = 0): number {
  return (from[at]! | (from[at + 1]! << 8)) & 0xffff;
}
