/**
 * The controllers the players play with, as the page detects them, and the game's buttons as
 * each names them: a PlayStation pad's own (its face buttons the original's pictures, where the
 * game draws them), an Xbox pad's and a Nintendo pad's letters for the face buttons in their
 * places (the bottom one is the cross), the shoulders by their names, a keyboard's keys, the
 * touch pad's numbers. A line that names START (or the select button alone) names a keyboard
 * player's key instead. `button-glyphs.ts` paints them.
 */
export type ControllerKind = 'playstation' | 'xbox' | 'nintendo' | 'keyboard' | 'touch';

/** A player's controller: its kind, and for a keyboard the key each of the pad's bits is on. */
export interface Controller {
  readonly kind: ControllerKind;
  readonly keys: Readonly<Record<number, string>>;
}

/** Both players' controllers, and the player who last pressed anything (whose a line for either shows). */
export interface Controllers {
  readonly players: readonly [Controller, Controller];
  readonly last: number;
}

export const PLAYSTATION: Controller = { kind: 'playstation', keys: {} };
export const CONSOLE_PADS: Controllers = { players: [PLAYSTATION, PLAYSTATION], last: 0 };

export const Bit = { L2: 0x01, R2: 0x02, L1: 0x04, R1: 0x08, TRIANGLE: 0x10, CIRCLE: 0x20, CROSS: 0x40, SQUARE: 0x80, SELECT: 0x100, START: 0x800 } as const;
export const FACE = new Set<number>([Bit.TRIANGLE, Bit.CIRCLE, Bit.CROSS, Bit.SQUARE]);

/** Each kind's names for the pad's buttons. */
const NAMES: Readonly<Record<Exclude<ControllerKind, 'keyboard'>, Readonly<Record<number, string>>>> = {
  playstation: { [Bit.L1]: 'L1', [Bit.R1]: 'R1', [Bit.L2]: 'L2', [Bit.R2]: 'R2', [Bit.START]: 'START', [Bit.SELECT]: 'SELECT' },
  xbox: { [Bit.CROSS]: 'A', [Bit.CIRCLE]: 'B', [Bit.SQUARE]: 'X', [Bit.TRIANGLE]: 'Y', [Bit.L1]: 'LB', [Bit.R1]: 'RB', [Bit.L2]: 'LT', [Bit.R2]: 'RT', [Bit.START]: 'MENU', [Bit.SELECT]: 'VIEW' },
  nintendo: { [Bit.CROSS]: 'B', [Bit.CIRCLE]: 'A', [Bit.SQUARE]: 'Y', [Bit.TRIANGLE]: 'X', [Bit.L1]: 'L', [Bit.R1]: 'R', [Bit.L2]: 'ZL', [Bit.R2]: 'ZR', [Bit.START]: '+', [Bit.SELECT]: '−' },
  touch: { [Bit.SQUARE]: '1', [Bit.TRIANGLE]: '2', [Bit.CROSS]: '3', [Bit.CIRCLE]: '4', [Bit.START]: 'START', [Bit.SELECT]: 'SELECT' },
};

/** A button's name on a controller (empty: it has none). */
export function buttonName(controller: Controller, bit: number): string {
  if (controller.kind === 'keyboard') return controller.keys[bit] ?? '';
  return NAMES[controller.kind][bit] ?? '';
}

/** Whether the game's own picture of a button shows it as it is on this controller (a PlayStation pad's face buttons). */
export function originalGlyph(controller: Controller, bit: number): boolean {
  return controller.kind === 'playstation' && FACE.has(bit);
}

/**
 * A printed line as a keyboard player reads it: START (and a lone SELECT, the button) named by
 * the key it is on, START BUTTON as a key; P1 and P2 by that player's keyboard, the rest by the
 * player who last pressed anything. Lines for other controllers are as the game prints them.
 */
export function controlWords(text: string, controllers: Controllers): string {
  if (!/\bSTART\b|^SELECT$/.test(text)) return text;
  const named = /\bP([12])\b/.exec(text);
  const controller = controllers.players[named === null ? controllers.last : Number(named[1]) - 1]!;
  if (controller.kind !== 'keyboard') return text;
  const start = controller.keys[Bit.START];
  const select = controller.keys[Bit.SELECT];
  let out = text;
  if (start !== undefined) out = out.replace(/\bSTART BUTTON\b/g, `${start} KEY`).replace(/\bSTART\b/g, start);
  if (select !== undefined && out === 'SELECT') out = select;
  return out;
}
