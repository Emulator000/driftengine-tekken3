/**
 * The versus screen: the portraits as the original has them, sliding in from the sides over
 * their colour's column inside light frames, and once they are in the backdrop
 * (`versus-art.ts`, the columns added into it) and the band behind the stage's line, run on to
 * the window's edges; the printer's lines (the names, VS, the stage) in type.
 */
import type { GameState, VersusRecord } from '../../sim/game/state.ts';
import type { ScreenLayer } from './screen.ts';
import { BACKDROP, COLUMN, paintBackdrop, paintBackdropsAhead, type BackdropSpan, type Column } from './versus-art.ts';

/** A portrait: the part the screen shows (its lines from the 20th) of a picture in the sheet's cells, and where it sits in its frame. */
const PORTRAIT = { w: 126, lines: 212, from: 20, columns: 8, cellW: 128, cellH: 256, left: 2, top: 6 } as const;
/** The frame's four light edges from the portrait's place: across and down, wide and tall. */
const FRAME = [
  [0, 0, 130, 6],
  [0, 218, 130, 6],
  [0, 6, 2, 212],
  [128, 6, 2, 212],
] as const;
const FRAME_COLOUR = [0.807, 0.807, 0.807, 1] as const;
/** The band: its height, and the length its end fades over. */
const BAND = { height: 0x24, fade: 0x6e } as const;
type Portrait = Extract<VersusRecord, { kind: 'portrait' }>;

const css = (colour: number, alpha: number): string => `rgba(${colour & 0xff}, ${(colour >> 8) & 0xff}, ${(colour >> 16) & 0xff}, ${alpha})`;

/** A portrait at its place less the slide still to go, in its frame, over its column while the slide runs (the backdrop has it after). */
function drawPortrait(game: GameState, art: ScreenLayer, sheet: ImageBitmap, record: Portrait): void {
  const countdown = game.versus.countdown;
  const x = record.x + ((countdown * record.slideX) >> 3);
  const y = record.y + ((countdown * record.slideY) >> 3);
  if (countdown !== 0) {
    art.ramp(
      [
        [0, 'rgba(0, 0, 0, 1)'],
        [1, css(record.colour, 1)],
      ],
      x + COLUMN.left,
      y + COLUMN.top,
      COLUMN.width,
      COLUMN.full - COLUMN.top,
    );
    art.ramp(
      [
        [0, css(record.colour, 1)],
        [1, `rgba(${COLUMN.grey}, ${COLUMN.grey}, ${COLUMN.grey}, 1)`],
      ],
      x + COLUMN.left,
      y + COLUMN.full,
      COLUMN.width,
      COLUMN.end - COLUMN.full,
    );
  }
  const number = game.versusPortraits[record.side]!;
  const picture = art.original(
    `versus portrait ${number}`,
    sheet,
    (number % PORTRAIT.columns) * PORTRAIT.cellW,
    Math.floor(number / PORTRAIT.columns) * PORTRAIT.cellH + PORTRAIT.from,
    PORTRAIT.w,
    PORTRAIT.lines,
    PORTRAIT.w,
    PORTRAIT.lines,
  );
  if (picture !== null) {
    const { u0, v0, u1, v1 } = picture.uv;
    art.put(picture, x + PORTRAIT.left, y + PORTRAIT.top, PORTRAIT.w, PORTRAIT.lines, record.flipped !== 0 ? { u0: u1, v0, u1: u0, v1 } : picture.uv);
  }
  for (const [dx, dy, w, h] of FRAME) art.fill(x + dx, y + dy, w, h, FRAME_COLOUR);
}

/** The band behind the stage's line, from the window's left edge, its last stretch fading out. */
function drawBand(art: ScreenLayer, record: Extract<VersusRecord, { kind: 'band' }>): void {
  const { left } = art.edges;
  const solid = record.width - BAND.fade;
  art.ramp(
    [
      [0, css(record.colour, 1)],
      [1, css(record.colour, 1)],
    ],
    left,
    record.y,
    solid - left,
    BAND.height,
    true,
  );
  art.ramp(
    [
      [0, css(record.colour, 1)],
      [1, css(record.colour, 0)],
    ],
    solid,
    record.y,
    BAND.fade,
    BAND.height,
    true,
  );
}

/** The span the backdrop covers in the art layer's window: the screen's units from edge to edge. */
function backdropSpan(art: ScreenLayer): BackdropSpan {
  const { left, right } = art.edges;
  return { from: Math.floor(left), to: Math.ceil(right), kx: art.kx, ky: art.ky };
}

/** Both backdrops painted ahead for the art layer's window (begun at its size). */
export function paintVersusAhead(art: ScreenLayer): void {
  paintBackdropsAhead(backdropSpan(art));
}

/**
 * The versus screen on the fields it draws (the slide and the frame after it): the scene stands at
 * step 2 or 3 after the slide's fields and at step 4 after the last, which the picture is held on
 * through the fight's loading, where it drew nothing on that one and the wait held a black screen.
 */
export function drawVersus(game: GameState, art: ScreenLayer, text: ScreenLayer, portraits: ImageBitmap): void {
  if (game.step < 2 || 4 < game.step) return;
  const records = game.versus.records;
  if (game.versus.countdown === 0) {
    const background = records.find((r) => r.kind === 'background');
    const columns: Column[] = records.filter((r): r is Portrait => r.kind === 'portrait').map((r) => ({ x: r.x, y: r.y, colour: r.colour }));
    if (background?.kind === 'background') {
      const span = backdropSpan(art);
      const { from, to } = span;
      const [w, h] = [(to - from) * art.kx, (BACKDROP.bottom - BACKDROP.top) * art.ky];
      const key = `versus backdrop ${background.picture} ${from} ${to} ${columns.map((c) => `${c.x},${c.y},${c.colour}`).join(' ')}`;
      const picture = art.atlas.picture(key, w, h, (g, l, t) => paintBackdrop(g, background.picture, { ...span, left: l, top: t }, columns));
      if (picture !== null) art.put(picture, from, BACKDROP.top, to - from, BACKDROP.bottom - BACKDROP.top);
    }
    for (const record of records) if (record.kind === 'band') drawBand(art, record);
  }
  for (const record of records) if (record.kind === 'portrait') drawPortrait(game, art, portraits, record);
  for (const run of game.printed) text.print(run);
}
