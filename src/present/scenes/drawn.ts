/**
 * What a scene drew besides the printer's runs (`GameState.drawn`), drawn new over the scene's
 * picture with the runs, each in its table entry as the original's are (entry 0 first; within an
 * entry, what was drawn later lies under what was drawn before): rectangles of colour, plain or
 * shaded from their corners; the original's small pictures (the Options' pad, modes' labels and
 * step arrows, the Theater's thumbnails, film frame, cover, caption and disc) enlarged smoothly; a
 * button box's pointer to the pad painted new as a line and a sliver; Practice's hit markers
 * painted new. The pad's buttons are shown
 * as the players' controllers have them: a line's for the player who last pressed anything (a
 * PlayStation pad's the game's own pictures), and on each key configuration side's pad that
 * side's controller's buttons over the PlayStation pad's own.
 */
import type { OptionsTables } from '../../sim/data/scenes.ts';
import type { GameState, PrintRun, SceneDraw } from '../../sim/game/state.ts';
import { paintButton } from '../2d/button-glyphs.ts';
import { Bit, buttonName, originalGlyph, type Controller, type Controllers } from '../2d/controls.ts';
import { paintMarker } from '../2d/markers.ts';
import type { ScreenLayer } from './screen.ts';

/** The pictures the scenes' draws use: the four buttons; the Options' pad's two pictures (the DualShock's, the standard pad's), modes' labels (in colour, then greyed) and step arrows (by colour); the Theater's thumbnails (with the film frame last), cover strip, caption and disc. */
export interface DrawnPictures {
  readonly buttons: ImageBitmap;
  readonly pads: ImageBitmap;
  readonly labels: ImageBitmap;
  readonly arrows: ImageBitmap;
  readonly thumbs: ImageBitmap;
  readonly cover: ImageBitmap;
  readonly caption: ImageBitmap;
  readonly disc: ImageBitmap;
}

/** What drawing them reads besides: the Options' tables (the pad's points), the players' controllers. */
export interface DrawnContext {
  readonly pictures: DrawnPictures;
  readonly options: OptionsTables;
  readonly controllers: Controllers;
}

const PAD = { w: 0x90, h: 0x88 } as const;
const LABEL = { w: 0x60, h: 0xe } as const;
/** An arrow's size, the up arrow's left and the down's, and the colours the picture has a row for. */
const ARROW = { w: 0xa, h: 0x10, up: 0, down: 0xa, colours: [5, 6, 10, 7, 11] } as const;
/** Practice's markers: the burst's size. */
const MARKER = 0x30;
/** An input display's icon: its size. */
const INPUT = { w: 0x13, h: 0x1f } as const;
/** A button's size, and its picture's place in the buttons' picture by its bit (square, triangle, cross, circle). */
const BUTTON = { w: 0xc, h: 0x14, order: [Bit.SQUARE, Bit.TRIANGLE, Bit.CROSS, Bit.CIRCLE] as number[] } as const;
/** A thumbnail's size and the thumbnails' columns, the film frame's picture; the Theater's pictures' sizes. */
const THUMB = { w: 0x30, h: 0x40, columns: 8, film: 61 } as const;
const THEATER = { cover: [108, 256], caption: [108, 14], disc: [20, 32] } as const;
/** A key configuration side's width; each face button's middle on the pad's pictures (the DualShock's, the standard pad's, from its corner), and the size of a face button's label and a shoulder's. */
const SIDE_WIDTH = 0xb8;
const FACE_MIDDLES: readonly Readonly<Record<number, readonly [number, number]>>[] = [
  { [Bit.TRIANGLE]: [118, 64], [Bit.CIRCLE]: [130, 82.5], [Bit.CROSS]: [117, 100.5], [Bit.SQUARE]: [104, 82.5] },
  { [Bit.TRIANGLE]: [114, 63.5], [Bit.CIRCLE]: [126, 82], [Bit.CROSS]: [113, 96.5], [Bit.SQUARE]: [99.5, 81.5] },
];
const PAD_FACE = { w: 0xd, h: 0x17 } as const;
const PAD_SHOULDER = { w: 0x16, h: 0x10 } as const;
/** A pointer's line, a unit thick, and its sliver's base across. */
const POINTER = { line: 1, base: 5, start: 2 } as const;

const rgb = (colour: number): [number, number, number] => [(colour & 0xff) / 0xff, ((colour >> 8) & 0xff) / 0xff, ((colour >> 16) & 0xff) / 0xff];
const css = (colour: number): string => `rgb(${colour & 0xff}, ${(colour >> 8) & 0xff}, ${(colour >> 16) & 0xff})`;

/** A crop of an original picture placed at its size in units. */
function crop(layer: ScreenLayer, name: string, source: ImageBitmap, sx: number, sy: number, w: number, h: number, x: number, y: number): void {
  const picture = layer.original(`${name} ${sx} ${sy}`, source, sx, sy, w, h, w, h);
  if (picture !== null) layer.put(picture, x, y, w, h);
}

/** A button box's pointer: a line from beside its start to the point on the pad, and a sliver from its start's base to that point. */
function pointer(layer: ScreenLayer, d: Extract<SceneDraw, { kind: 'pointer' }>): void {
  const left = Math.min(d.x, d.toX) - 1;
  const top = Math.min(d.y, d.toY) - 1;
  const w = Math.max(d.x + POINTER.base, d.toX) + 1 - left;
  const h = Math.max(d.y, d.toY) + 1 - top;
  const [pw, ph] = [Math.max(1, Math.round(w * layer.kx)), Math.max(1, Math.round(h * layer.ky))];
  const key = `pointer ${d.x - left} ${d.y - top} ${d.toX - left} ${d.toY - top} ${w} ${h} ${d.colour} ${pw} ${ph}`;
  const picture = layer.atlas.picture(key, pw, ph, (g, x0, y0) => {
    const at = (x: number, y: number): [number, number] => [x0 + (x - left) * layer.kx, y0 + (y - top) * layer.ky];
    g.fillStyle = css(d.colour);
    g.strokeStyle = css(d.colour);
    g.beginPath();
    g.moveTo(...at(d.x, d.y));
    g.lineTo(...at(d.x + POINTER.base, d.y));
    g.lineTo(...at(d.toX, d.toY));
    g.closePath();
    g.fill();
    g.lineWidth = POINTER.line * layer.ky;
    g.beginPath();
    g.moveTo(...at(d.x + POINTER.start, d.y));
    g.lineTo(...at(d.toX, d.toY));
    g.stroke();
  });
  if (picture !== null) layer.put(picture, left, top, w, h);
}

/** A controller's button painted new in a box in units (nothing for a button it has no name for). */
function glyph(layer: ScreenLayer, controller: Controller, bit: number, x: number, y: number, w: number, h: number): void {
  const name = buttonName(controller, bit);
  if (name === '' && !originalGlyph(controller, bit)) return;
  const [pw, ph] = [Math.max(1, Math.round(w * layer.kx)), Math.max(1, Math.round(h * layer.ky))];
  const picture = layer.atlas.picture(`control ${controller.kind} ${bit} ${name} ${pw} ${ph}`, pw, ph, (g, left, top) => paintButton(g, controller, bit, left, top, pw, ph));
  if (picture !== null) layer.put(picture, x, y, w, h);
}

/** A key configuration side's pad (its picture's corner at x, y) labelled with its controller's buttons: each face button over its symbol, each shoulder where its box's line reaches. */
function padLabels(layer: ScreenLayer, tables: OptionsTables, controller: Controller, side: number, x: number, y: number, dualShock: boolean): void {
  if (controller.kind === 'playstation') return;
  const picture = dualShock ? 0 : 1;
  for (const key of tables.keys) {
    const face = FACE_MIDDLES[picture]![key.bit];
    const point = tables.padPoints[picture]![key.key]!;
    const [middleX, middleY] = face === undefined ? [side * SIDE_WIDTH + point.x, point.y] : [x + face[0], y + face[1]];
    const size = face === undefined ? PAD_SHOULDER : PAD_FACE;
    glyph(layer, controller, key.bit, middleX - size.w / 2, middleY - size.h / 2, size.w, size.h);
  }
}

/** A rectangle shaded from its corners' colours (top left, top right, bottom left, bottom right), as the GPU shades it between them. */
function shade(layer: ScreenLayer, d: Extract<SceneDraw, { kind: 'shade' }>): void {
  const picture = layer.atlas.picture(`shade ${d.colours.join(' ')}`, 2, 2, (g, left, top) => {
    d.colours.forEach((colour, i) => {
      g.fillStyle = css(colour);
      g.fillRect(left + (i & 1), top + (i >> 1), 1, 1);
    });
  });
  if (picture === null) return;
  /* Sampled between the four texels' middles, so the colours run corner to corner. */
  const { u0, v0, u1, v1 } = picture.uv;
  const [du, dv] = [(u1 - u0) / 4, (v1 - v0) / 4];
  layer.put(picture, d.x, d.y, d.w, d.h, { u0: u0 + du, v0: v0 + dv, u1: u1 - du, v1: v1 - dv });
}

function drawOne(layer: ScreenLayer, context: DrawnContext, d: SceneDraw): void {
  const { pictures, options: tables, controllers } = context;
  switch (d.kind) {
    case 'tile':
      layer.fill(d.x, d.y, d.w, d.h, [...rgb(d.colour), 1]);
      break;
    case 'shade':
      shade(layer, d);
      break;
    case 'button': {
      const controller = controllers.players[controllers.last]!;
      const at = BUTTON.order.indexOf(d.bit);
      if (originalGlyph(controller, d.bit) && 0 <= at) crop(layer, 'button', pictures.buttons, at * BUTTON.w, 0, BUTTON.w, BUTTON.h, d.x, d.y);
      else glyph(layer, controller, d.bit, d.x, d.y, BUTTON.w, BUTTON.h);
      break;
    }
    case 'thumb':
    case 'film': {
      const n = d.kind === 'film' ? THUMB.film : d.picture;
      crop(layer, 'thumb', pictures.thumbs, (n % THUMB.columns) * THUMB.w, Math.floor(n / THUMB.columns) * THUMB.h, THUMB.w, THUMB.h, d.x, d.y);
      break;
    }
    case 'picture': {
      const [w, h] = THEATER[d.picture];
      crop(layer, d.picture, pictures[d.picture], 0, 0, w, h, d.x, d.y);
      break;
    }
    case 'label':
      crop(layer, 'label', pictures.labels, d.grey ? LABEL.w : 0, d.label * LABEL.h, LABEL.w, LABEL.h, d.x, d.y);
      break;
    case 'pad': {
      crop(layer, 'pad', pictures.pads, d.dualShock ? 0 : PAD.w, 0, PAD.w, PAD.h, d.x, d.y);
      const side = Math.round(d.x / SIDE_WIDTH);
      padLabels(layer, tables, controllers.players[side] ?? controllers.players[0], side, d.x, d.y, d.dualShock);
      break;
    }
    case 'arrow': {
      const row = Math.max(0, (ARROW.colours as readonly number[]).indexOf(d.colour));
      crop(layer, 'arrow', pictures.arrows, d.down ? ARROW.down : ARROW.up, row * ARROW.h, ARROW.w, ARROW.h, d.x, d.y);
      break;
    }
    case 'pointer':
      pointer(layer, d);
      break;
    case 'marker': {
      const [pw, ph] = [Math.max(1, Math.round(MARKER * layer.kx)), Math.max(1, Math.round(MARKER * layer.ky))];
      const picture = layer.atlas.picture(`marker ${d.marker} ${pw} ${ph}`, pw, ph, (g, left, top) => paintMarker(g, d.marker, left, top, pw, ph));
      if (picture !== null) layer.put(picture, d.x - MARKER / 2, d.y - MARKER / 2, MARKER, MARKER);
      break;
    }
    case 'input':
      inputIcon(layer, controllers.players[controllers.last]!, d);
      break;
  }
}

const PAD_ARROW: Readonly<Record<number, number>> = { 0x1000: -90, 0x3000: -45, 0x2000: 0, 0x6000: 45, 0x4000: 90, 0xc000: 135, 0x8000: 180, 0x9000: -135 };
/** The face buttons by where they sit: top, left, right, bottom. */
const FACE_PLACES: readonly (readonly [number, number, number])[] = [
  [Bit.TRIANGLE, 0.5, 0.27],
  [Bit.SQUARE, 0.27, 0.5],
  [Bit.CIRCLE, 0.73, 0.5],
  [Bit.CROSS, 0.5, 0.73],
];
const FACE_COLOURS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  playstation: { [Bit.TRIANGLE]: '#3fd0a0', [Bit.SQUARE]: '#e88ad8', [Bit.CIRCLE]: '#f05a5a', [Bit.CROSS]: '#7f9cf0' },
  xbox: { [Bit.TRIANGLE]: '#ecbd2c', [Bit.SQUARE]: '#3a86e0', [Bit.CIRCLE]: '#e0403a', [Bit.CROSS]: '#62b146' },
};

/**
 * An input display's icon painted new: a direction as an arrow on a disc (lit blue, or dim); a
 * set of buttons as the four face buttons where the controller has them, those in the set lit in
 * the controller's colours (a keyboard's with their keys).
 */
function inputIcon(layer: ScreenLayer, controller: Controller, d: Extract<SceneDraw, { kind: 'input' }>): void {
  const [pw, ph] = [Math.max(1, Math.round(INPUT.w * layer.kx)), Math.max(1, Math.round(INPUT.h * layer.ky))];
  const direction = d.pad & 0xf000;
  const key = direction !== 0 ? `input arrow ${direction} ${d.lit} ${pw} ${ph}` : `input buttons ${controller.kind} ${d.pad} ${d.lit} ${pw} ${ph}`;
  const picture = layer.atlas.picture(key, pw, ph, (g, left, top) => {
    const r = Math.min(pw, ph) * 0.46;
    const [cx, cy] = [left + pw / 2, top + ph / 2];
    if (direction !== 0) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = d.lit === 0 ? '#d8d8d8' : '#3a3a3a';
      g.fill();
      g.save();
      g.translate(cx, cy);
      g.rotate(((PAD_ARROW[direction] ?? 0) * Math.PI) / 180);
      g.beginPath();
      g.moveTo(r * 0.75, 0);
      g.lineTo(-r * 0.15, -r * 0.55);
      g.lineTo(-r * 0.15, -r * 0.2);
      g.lineTo(-r * 0.7, -r * 0.2);
      g.lineTo(-r * 0.7, r * 0.2);
      g.lineTo(-r * 0.15, r * 0.2);
      g.lineTo(-r * 0.15, r * 0.55);
      g.closePath();
      g.fillStyle = d.lit === 0 ? '#2060f0' : '#58628a';
      g.fill();
      g.restore();
      return;
    }
    g.beginPath();
    g.roundRect(left + pw * 0.04, top + ph * 0.18, pw * 0.92, ph * 0.64, r * 0.4);
    g.fillStyle = d.lit !== 0 ? '#e8e8e8' : '#505050';
    g.fill();
    const colours = FACE_COLOURS[controller.kind];
    for (const [bit, fx, fy] of FACE_PLACES) {
      const on = (d.pad & bit) !== 0;
      const [x, y] = [left + pw * fx, top + ph * (0.18 + 0.64 * fy)];
      g.beginPath();
      g.arc(x, y, Math.min(pw, ph) * 0.15, 0, Math.PI * 2);
      g.fillStyle = on ? (colours?.[bit] ?? '#ffffff') : '#2a2a2a';
      g.fill();
      const name = controller.kind === 'playstation' ? '' : buttonName(controller, bit);
      if (on && name !== '') {
        g.fillStyle = '#101010';
        g.font = `700 ${Math.min(pw, ph) * 0.2}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, x, y);
      }
    }
  });
  if (picture !== null) layer.put(picture, d.x, d.y, INPUT.w, INPUT.h);
}

/** The printer's runs and the scene's draws, together in the original's order. */
export function drawScene(game: Pick<GameState, 'printed' | 'drawn'>, layer: ScreenLayer, context: DrawnContext): void {
  /* Everything in the order it was drawn, the runs among the rest where they were printed. */
  const all: { layer: number; run?: PrintRun; drawn?: SceneDraw }[] = [];
  const runs = game.printed;
  let next = 0;
  for (const drawn of game.drawn) {
    for (; next < drawn.at && next < runs.length; next += 1) all.push({ layer: runs[next]!.layer, run: runs[next]! });
    all.push({ layer: drawn.layer, drawn });
  }
  for (; next < runs.length; next += 1) all.push({ layer: runs[next]!.layer, run: runs[next]! });
  const order = all.map((item, i) => ({ item, i })).sort((a, b) => a.item.layer - b.item.layer || b.i - a.i);
  for (const { item } of order) {
    if (item.run !== undefined) layer.print(item.run);
    else if (item.drawn !== undefined) drawOne(layer, context, item.drawn);
  }
}
