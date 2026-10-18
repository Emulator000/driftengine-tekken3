/**
 * Where the HUD's pieces go this field, from what the fight's HUD step decided (`state.hud`): the
 * original's places, in its screen's units (480 lines high, x 192 at the middle of the 4:3
 * picture), in the order it draws them, so a piece drawn over another stays over it.
 *
 * The back (behind the calls): each bar's parts (the health, the damage just taken, the lost rest)
 * and its two end caps, the timer, the round marks, and each name on its plate. The front: Tekken
 * Ball's two charge gauges at the bottom (each side's charge, the trail of what it lost, the empty
 * rest, between two caps, the side whose charge the ball carries pulsing), then the calls, each in
 * the block the original's printer fills, the last printed drawn first.
 *
 * Tekken Force's back has three gauges (the player's, and each enemy's in play, its length by the
 * enemy's kind, its right end lined up under the first enemy's) and their three names, with the
 * timer; its front the keys held, bottom left, then the calls, a run of digits laid a glyph a cell
 * as the printer lays it (the score and the clocks change every field). Over everything its
 * progress bar: four segments, one a stage, the stages cleared half lit in their colours, those to
 * come half dark, the current one lit to the camera's progress by a pulsing light added over the
 * picture, the final stage's red box pulsing past them; lines between, a cursor at the progress and
 * a turning marker over it.
 */
import type { FightData, FightState } from '../../sim/fight/state.ts';
import { TeamMark } from '../../sim/fight/hud.ts';

export type BarPart = 'health' | 'damage' | 'lost' | 'empty';

/** A bar's part and a cap, `glow` their brightness when it is not the usual (a pulsing gauge's). */
export type HudPiece =
  | { readonly kind: 'bar'; readonly part: BarPart; readonly glow?: number | undefined }
  | { readonly kind: 'cap'; readonly end: 0 | 1; readonly glow?: number | undefined }
  | { readonly kind: 'timer'; readonly text: string }
  | { readonly kind: 'mark'; readonly lit: boolean }
  | { readonly kind: 'team'; readonly crossed: boolean; readonly beaten: boolean }
  | { readonly kind: 'name'; readonly side: 0 | 1; readonly text: string; readonly costume: number }
  | { readonly kind: 'player'; readonly side: 0 | 1; readonly text: string }
  | { readonly kind: 'key'; readonly index: number }
  | { readonly kind: 'call'; readonly font: number; readonly colour: number; readonly text: string };

/**
 * A piece and its place. A name's place is its line: `x` where it starts (the first side's) or ends
 * (the second's), `w` 0, its plate under its lower part.
 */
export interface PlacedPiece {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly piece: HudPiece;
}

/** Each side's bar: its place, and which end its parts start from (the first side's from its right). */
const BARS = [
  { x: 10, y: 40, fromRight: true },
  { x: 202, y: 40, fromRight: false },
] as const;
const BAR = { length: 0x98, height: 0x18, inset: 2, capWidth: 6, rightCap: 0x96 };
const PARTS: readonly BarPart[] = ['health', 'damage', 'lost'];
/** The timer: its two digits' cells, the tens a step left of the ones. */
const TIMER = { ones: 0xb8, y: 0x16, step: 0xf, width: 0x10, height: 0x2e };
const MARKS = { x: [0x97, 0xca], step: [-0xe, 0xe], y: 0x46, width: 0xf, height: 0x12 };
/** Team Battle's members' marks: each side's first, the step between them, their line and size. */
const TEAM_MARKS = { x: [0x9c, 0xca], step: [-9, 9], y: 0x40, width: 10, height: 0x18 };
const NAMES = { x: [14, 354], y: 66, height: 16 };
/** An online player's name, under their fighter's: its line's top and height. */
const PLAYERS = { y: 84, height: 11 };
/** The printer's fonts' cells: each glyph's advance, width and height. */
const FONTS = [
  { advance: 9, width: 10, height: 16 },
  { advance: 13, width: 14, height: 24 },
  { advance: 22, width: 24, height: 40 },
] as const;
/** Tekken Ball's gauges: each side's place, which way it fills, and its fill's colour; their length, the pause menu's command lists' choice (which hides them with two humans), and the mode. */
const GAUGES = [
  { x: 0xa, y: 0x1b2, rightward: true, fill: 'lost' },
  { x: 0x116, y: 0x1b2, rightward: false, fill: 'damage' },
] as const;
const GAUGE = { length: 0x4c, rightCap: 0x4a, start: [0x4e, 2] } as const;
const COMMAND_LISTS = 2;
const TEKKEN_BALL = 7;
/**
 * Tekken Force's gauges (the player's, then each enemy's, their right ends lined up) and the
 * player's full length; its name rows (the first from its left end, the others to their right
 * ends); its keys' place, step and size; the soldiers' roster, whose names keep the first
 * costume's colours; and the mode.
 */
const FORCE_GAUGES = [
  { x: 10, y: 40 },
  { x: 202, y: 40 },
  { x: 202, y: 88 },
] as const;
const FORCE_FULL = 0x9c;
const FORCE_NAMES = [
  { x: 14, y: 66, side: 0 },
  { x: 354, y: 66, side: 1 },
  { x: 354, y: 114, side: 1 },
] as const;
const KEYS = { x: 0, y: 420, step: 20, width: 20, height: 36, most: 3 } as const;
const SOLDIERS = 0x15;
const TEKKEN_FORCE = 8;
/** A run of digits (and the clocks' marks) the printer lays a glyph a cell. */
const DIGITS = /^[0-9 "']+$/;
/**
 * The progress bar: its segments' first left and width, its lines; the final stage's box; the
 * lines between the segments (white to half grey); the marker over the cursor, its lines and its
 * widest swing; the final stage.
 */
const PROGRESS = { left: 64, segment: 60, top: 436, height: 16, box: { x: 304, w: 12 }, separators: [63, 123, 183, 243, 303], marker: { top: 424, height: 12, swing: 12 } } as const;
const FINAL_STAGE = 4;
const WHITE = [1, 1, 1] as const;
const BLACK = [0, 0, 0] as const;
const HALF_GREY = [0x80 / 0xff, 0x80 / 0xff, 0x80 / 0xff] as const;
const MARKER_BLUE = [0, 0x80 / 0xff, 1] as const;

/**
 * A quad of the progress bar in the fight's units: laid over at half (as the original averages it
 * with the picture) or added, its colour (0 to 1 a channel) from its top to its bottom; the marker
 * a triangle pointing down in that box.
 */
export interface BarLight {
  readonly blend: 'over' | 'add';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly top: readonly [number, number, number];
  readonly bottom: readonly [number, number, number];
  readonly alpha: number;
  readonly triangle: boolean;
}
/** The HUD screen's middle, in its units (384 across). */
const HUD_MIDDLE = 192;
/** The infinity sign the timer shows when it is stopped. */
export const INFINITY = '∞';

/**
 * An online match's streaks of wins, each side's printed as the game prints a Versus streak ("WIN:1",
 * "WINS:12", its small font at the foot under its side): where each starts by its digits (one win, up
 * to 9, 99, 999) and side.
 */
const STREAK = { font: 1, colour: 8, y: 0x1b0, x: [[12, 291], [12, 278], [12, 265], [12, 252]] } as const;

/** Each side's streak of wins (none under one) as a print of the game's own. */
function streakPrints(streaks: readonly [number, number] | null): FightState['hud']['prints'] {
  if (streaks === null) return [];
  return streaks.flatMap((wins, side) => {
    if (!(wins > 0)) return [];
    const digits = wins < 2 ? 0 : wins < 10 ? 1 : wins < 100 ? 2 : 3;
    return [{ font: STREAK.font, colour: STREAK.colour, x: STREAK.x[digits]![side]!, y: STREAK.y, text: `${wins < 2 ? 'WIN' : 'WINS'}:${wins}` }];
  });
}

/** The calls, each in its printer block, the last printed first; with `cells`, a run of digits a glyph a cell; `swapped`, each block at its mirrored place (`HUD_MIDDLE` its middle); `added`, prints the fight's own do not have. */
function calls(state: FightState, cells = false, swapped = false, added: FightState['hud']['prints'] = []): PlacedPiece[] {
  return [...state.hud.prints, ...added]
    .filter((print) => FONTS[print.font] !== undefined && print.text.length > 0)
    .flatMap((print): PlacedPiece[] => {
      const font = FONTS[print.font]!;
      const piece = (text: string, x: number, w: number): PlacedPiece => ({ x: swapped ? HUD_MIDDLE * 2 - x - w : x, y: print.y, w, h: font.height, piece: { kind: 'call', font: print.font, colour: print.colour, text } });
      if (!cells || !DIGITS.test(print.text)) return [piece(print.text, print.x, (print.text.length - 1) * font.advance + font.width)];
      return [...print.text].flatMap((glyph, i) => (glyph === ' ' ? [] : [piece(glyph, print.x + i * font.advance, font.width)])).reverse();
    })
    .reverse();
}

/** Tekken Force's back: the name rows, the timer and the three gauges, in the order they are added (drawn last to first). */
function forceBack(state: FightState, data: Pick<FightData, 'roster' | 'force'>): PlacedPiece[] {
  const hud = state.hud;
  const added: PlacedPiece[] = [];
  /* An enemy's row and gauge show while it is in play, from the round's start on. */
  const shown = (i: number): boolean => i === 0 || (state.fighters[i]!.pushImmune === 0 && state.round.flow !== 0);
  FORCE_NAMES.forEach(({ x, y, side }, row) => {
    if (!shown(row)) return;
    const code = hud.forceNames[row]!;
    added.push({ x, y, w: 0, h: NAMES.height, piece: { kind: 'name', side, text: data.roster.codes[code]?.name ?? '', costume: code >> 2 === SOLDIERS ? 0 : code & 3 } });
  });
  added.push(timer(state));
  FORCE_GAUGES.forEach(({ x, y }, i) => {
    if (!shown(i)) return;
    const full = i === 0 ? FORCE_FULL : (data.force.kinds[state.force.slots[i - 1]!.kind]?.gauge ?? FORCE_FULL);
    const length = full - 4;
    const left = x - (full - FORCE_FULL);
    const bar = hud.forceBars[i]!;
    added.push({ x: left, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 0 } });
    added.push({ x: left + full - BAR.capWidth, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 1 } });
    const lengths = [bar.shown, bar.trail - bar.shown, length - bar.trail];
    let cursor = left + BAR.inset + length;
    PARTS.forEach((part, k) => {
      const run = lengths[k]!;
      if (run <= 0) return;
      cursor -= run;
      added.push({ x: cursor, y, w: run, h: BAR.height, piece: { kind: 'bar', part } });
    });
  });
  return added.reverse();
}

/** Tekken Force's keys held, each in its place. */
function keys(state: FightState): PlacedPiece[] {
  return Array.from({ length: Math.min(KEYS.most, state.force.keysShown) }, (_, index) => ({ x: KEYS.x + index * KEYS.step, y: KEYS.y, w: KEYS.width, h: KEYS.height, piece: { kind: 'key', index } }) as const);
}

/** The timer's two digits, or the infinity sign. */
function timer(state: FightState): PlacedPiece {
  const hud = state.hud;
  const tens = TIMER.ones - TIMER.step;
  const text = hud.timerShown === -1 ? INFINITY : String((hud.timerShown % 100) + 100).slice(1);
  return { x: tens, y: TIMER.y, w: TIMER.ones + TIMER.width - tens, h: TIMER.height, piece: { kind: 'timer', text } };
}

/** Tekken Ball's gauges, the lit one's brightness swinging from none to double with the field count (held while paused). */
function gauges(state: FightState): PlacedPiece[] {
  if (state.mode !== TEKKEN_BALL || (state.pauseMenu.choice === COMMAND_LISTS && state.match.humanCount !== 1)) return [];
  const ball = state.ball;
  const added: PlacedPiece[] = [];
  GAUGES.forEach(({ x, y, rightward, fill }, side) => {
    const gauge = ball.gauges[side]!;
    let glow: number | undefined;
    if (ball.gaugeLit === 1 << side && state.pause.requested === 0) {
      const t = (state.vsyncSeen << 4) & 0x1ff;
      glow = (0xff < t ? 0x1ff - t : t) / 0x80;
    }
    const parts: [BarPart, number][] = [
      [fill, gauge.shown],
      ['health', gauge.trail - gauge.shown],
      ['empty', GAUGE.length - gauge.trail],
    ];
    let cursor = x + GAUGE.start[rightward ? 1 : 0];
    for (const [part, length] of parts) {
      if (length <= 0) continue;
      const left = rightward ? cursor : cursor - length;
      cursor = rightward ? cursor + length : left;
      added.push({ x: left, y, w: length, h: BAR.height, piece: { kind: 'bar', part, glow } });
    }
    added.push({ x, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 0, glow } });
    added.push({ x: x + GAUGE.rightCap, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 1, glow } });
  });
  return added;
}

/**
 * The back's pieces, in the order they are added (drawn last to first); `swapped`, each side's place
 * showing the other side's; `players`, in an online match, each side's player's name under its fighter's
 * (its streak of wins at the foot, `streakPrints`).
 */
function back(state: FightState, names: readonly string[], swapped = false, players: readonly string[] | null = null): PlacedPiece[] {
  const hud = state.hud;
  const added: PlacedPiece[] = [];
  const of = (side: number): number => (swapped ? 1 - side : side);
  for (const side of [0, 1] as const) {
    added.push({ x: NAMES.x[side]!, y: NAMES.y, w: 0, h: NAMES.height, piece: { kind: 'name', side, text: names[of(side)] ?? '', costume: state.fighters[of(side)]!.rosterCode & 3 } });
    const player = players?.[of(side)] ?? '';
    if (player !== '') added.push({ x: NAMES.x[side]!, y: PLAYERS.y, w: 0, h: PLAYERS.height, piece: { kind: 'player', side, text: player } });
  }
  [0, 1].map((side) => hud.teamMarks[of(side)] ?? []).forEach((marks, side) => {
    marks.forEach((mark, i) => {
      added.push({ x: TEAM_MARKS.x[side]! + i * TEAM_MARKS.step[side]!, y: TEAM_MARKS.y, w: TEAM_MARKS.width, h: TEAM_MARKS.height, piece: { kind: 'team', crossed: (mark & TeamMark.CROSSED) !== 0, beaten: (mark & TeamMark.BEATEN) !== 0 } });
    });
  });
  [0, 1].map((side) => hud.marksLit[of(side)] ?? []).forEach((marks, side) => {
    marks.forEach((lit, i) => {
      added.push({ x: MARKS.x[side]! + i * MARKS.step[side]!, y: MARKS.y, w: MARKS.width, h: MARKS.height, piece: { kind: 'mark', lit: lit !== 0 } });
    });
  });
  added.push(timer(state));
  for (let side = 0; side < 2; side += 1) {
    const { x, y, fromRight } = BARS[side]!;
    const bar = hud.bars[of(side)]!;
    added.push({ x, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 0 } });
    added.push({ x: x + BAR.rightCap, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 1 } });
    const lengths = [bar.shown, bar.damage - bar.shown, BAR.length - bar.damage];
    let cursor = fromRight ? x + BAR.inset + BAR.length : x + BAR.inset;
    PARTS.forEach((part, k) => {
      const length = lengths[k]!;
      if (length === 0) return;
      const left = fromRight ? cursor - length : cursor;
      cursor = fromRight ? left : cursor + length;
      added.push({ x: left, y, w: length, h: BAR.height, piece: { kind: 'bar', part } });
    });
  }
  return added.reverse();
}

/**
 * The HUD's pieces this field, given each side's name (and in Tekken Force the match's tables): the
 * back's, then the front's, each in drawing order. `swapped` (a fight drawn mirrored), each side's
 * plate showing the other side's fighter, so the fighter on the left has the left plate, and each
 * call at its mirrored place.
 */
export function layOutHud(state: FightState, names: readonly string[], data?: Pick<FightData, 'roster' | 'force'>, swapped = false, players: readonly string[] | null = null, streaks: readonly [number, number] | null = null): { back: PlacedPiece[]; front: PlacedPiece[] } {
  if (state.mode === TEKKEN_FORCE && data !== undefined) return { back: state.hud.back === 0 ? [] : forceBack(state, data), front: [...keys(state), ...calls(state, true)] };
  return { back: state.hud.back === 0 ? [] : back(state, names, swapped, players), front: [...gauges(state), ...calls(state, false, swapped, streakPrints(state.hud.shown !== 0 ? streaks : null))] };
}

/** Tekken Force's progress bar this field, in drawing order (its marker, the final box, the segments from the last, the lines, the cursor). */
export function progressBar(state: FightState, data: Pick<FightData, 'math' | 'force'>): BarLight[] {
  const { stage, barPos: pos, barPhase: phase } = state.force;
  const sin = data.math.sine[phase & 0xfff]!;
  const pulse = Math.min(0xff, ((sin + 0x1000) >> 6) + 0x80);
  const colour = (k: number, level: number): [number, number, number] => {
    const [r, g, b] = data.force.barColours[k]!;
    return [Math.min(1, (r! * level) / 0x80 / 0xff), Math.min(1, (g! * level) / 0x80 / 0xff), Math.min(1, (b! * level) / 0x80 / 0xff)];
  };
  const quad = (blend: 'over' | 'add', x: number, w: number, rgb: readonly [number, number, number], alpha: number): BarLight => ({ blend, x, y: PROGRESS.top, w, h: PROGRESS.height, top: rgb, bottom: rgb, alpha, triangle: false });
  const out: BarLight[] = [];
  const swing = Math.trunc(Math.trunc((sin * PROGRESS.marker.swing) / 4096) / 2);
  out.push({ blend: 'over', x: pos - Math.abs(swing), y: PROGRESS.marker.top, w: Math.abs(swing) * 2, h: PROGRESS.marker.height, top: MARKER_BLUE, bottom: WHITE, alpha: 1, triangle: true });
  if (stage === FINAL_STAGE) out.push(quad('add', PROGRESS.box.x, PROGRESS.box.w, colour(3, pulse), 1));
  for (let k = 3; 0 <= k; k -= 1) {
    const left = PROGRESS.left + k * PROGRESS.segment;
    if (k < stage) out.push(quad('over', left, PROGRESS.segment, colour(k, 0x80), 0.5));
    else if (stage < k) out.push(quad('over', left, PROGRESS.segment, BLACK, 0.5));
    else {
      out.push(quad('add', left, pos - left, colour(k, pulse), 1));
      out.push(quad('over', pos, left + PROGRESS.segment - pos, BLACK, 0.5));
    }
  }
  for (const x of [...PROGRESS.separators].reverse()) out.push({ blend: 'over', x, y: PROGRESS.top, w: 1, h: PROGRESS.height, top: WHITE, bottom: HALF_GREY, alpha: 1, triangle: false });
  out.push({ blend: 'over', x: pos, y: PROGRESS.top, w: 1, h: PROGRESS.height, top: WHITE, bottom: WHITE, alpha: 1, triangle: false });
  return out.filter((q) => 0 < q.w);
}
