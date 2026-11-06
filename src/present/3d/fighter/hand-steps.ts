/**
 * The step an arcade board's model draws a hand at. The console's models hold four steps from an
 * open hand to a fist (`modelStep` in the game's hands), the board's thirty-three, one for each
 * sixteenth of the game's shape from 0 (open) to 512 (a fist), and after either the other shapes, one
 * for each shape past 512. A replay keeps the console's step it drew, so while one plays a board's
 * model draws the board's step that stands for it.
 */

/** A fist, as the game's shape for a hand has it. */
const FIST = 0x200;
/** The board's steps from open to a fist: one a sixteenth of the shape. */
const BOARD_STEP = 4;
/** The board's step for each of the console's from open to a fist: the shape each begins at. */
const FROM_CONSOLE = [0, 16, 24, 32] as const;
/** The console's first other shape's step, and the board's. */
const CONSOLE_OTHERS = 4;
const BOARD_OTHERS = (FIST >> BOARD_STEP) + 1;

/**
 * The board model's step for a hand at the game's `shape`; while a replay plays (`replaying`), the
 * one for the console's `drawn` step it kept.
 */
export function boardHandStep(shape: number, drawn: number, replaying: boolean): number {
  if (replaying) return drawn < CONSOLE_OTHERS ? FROM_CONSOLE[drawn]! : drawn - CONSOLE_OTHERS + BOARD_OTHERS;
  return shape <= FIST ? Math.max(0, shape) >> BOARD_STEP : shape - FIST - 1 + BOARD_OTHERS;
}
