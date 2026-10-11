/**
 * The character select: the characters' portraits and icons as the original has them, and drawn
 * new around them on the original's design, across the whole window: the steel truss climbing
 * behind (`select-frame.ts`), the title in type, the pillars and the panel, the light behind each
 * portrait in its character's colour, an empty side's silhouette, the cursors and their tags, the
 * names, the countdown, an arrival's arrows, the sparkles rising over the portraits, and the
 * printer's lines. The light, the portraits' fades, the silhouette and the sparkles are added to
 * and taken away from the picture as the original's GPU blends them (`LightLayer`).
 */
import type { SceneTables } from '../../sim/data/scenes.ts';
import type { RosterTables } from '../../sim/data/roster.ts';
import { CELL_STEP, cellStep, lookOf, NO_ONE, SideState } from '../../sim/game/select.ts';
import type { GameState } from '../../sim/game/state.ts';
import type { TypeStyle } from '../2d/type.ts';
import { DISPLAY, NUMERALS } from '../2d/typefaces.ts';
import type { LightLayer, Rgb } from '../2d/light.ts';
import { paintOriginal, type ScreenLayer } from './screen.ts';
import { paintSelectFrame } from './select-frame.ts';
import { paintWallTile, TILE } from './select-wall.ts';

/** The characters' original pictures the select shows. */
export interface SelectPictures {
  readonly portraits: ImageBitmap;
  readonly bigIcons: ImageBitmap;
  readonly smallIcons: ImageBitmap;
}

/** The display area's top line, how far the truss climbs a field (in sixteenths), the portrait and the icons' sizes. */
const AREA_TOP = 20;
const RISE = 0x80;
const PORTRAIT = { w: 126, h: 252, columns: 8, cellW: 128, cellH: 256 } as const;
const ICON = { w: 0x20, big: 0x44, small: 0x3a } as const;
/** The empty small icon's column, past the characters'. */
const EMPTY_ICON = 23;
const SILHOUETTE = 0x15;
/** Each look's three bands' heights (by the look's top two bits) and the fades at their edges (of 256). */
const BANDS = [
  [30, 162, 60],
  [30, 176, 46],
  [0, 192, 60],
  [0, 206, 46],
] as const;
const EDGES = [8, 256, 256, 16] as const;
/** The light behind a portrait: how far above it starts, where it is fullest, where it ends greyed. */
const LIGHT = { above: 0x14, full: 0xd0, end: 0x118, grey: 0xc0 } as const;
/** The floor under the band: how far below the band it starts, and its red with two rows. */
const FLOOR = { below: 0x10, red: 0xd0 } as const;
/** A cursor: its two halves' width, its left past its cell's, its tag's size. */
const CURSOR = { half: 0x12, left: 2, tagW: 0x14, tagH: 0x10 } as const;
/** The countdown's ones cell and the tens' a step left, each digit's cell. */
const TIMER = { ones: 0xb8, step: 0xf, w: 0x10, h: 0x2e, cap: 38, baseline: 43 } as const;
/** A name's line and its capitals' height. */
const NAME = { h: 16, cap: 12, baseline: 14 } as const;
/** The arrows: their places, size, and the band's height above which they sit. */
const ARROWS = { left: 0xc, right: 0x15a, w: 0x10, h: 0x0a, above: 0xa0 } as const;
/** A sparkle's height, and how far above the band the sparkles are cut. */
const SPARKLE = { height: 0xa0, cut: 0x12 } as const;
/** Each side's cursor colours (its own, and as practice's partner). */
const SIDE_COLOURS = [
  ['#ff3a2a', '#ffd040'],
  ['#3a8cff', '#ffd040'],
] as const;

/** The title over the truss: its lines' text, centre, baseline and capitals' height. */
const TITLE_LINES = [
  { text: 'PLAYER', baseline: 0x58, cap: 24 },
  { text: 'THE KING OF IRON FIST TOURNAMENT 3', baseline: 0x6f, cap: 9 },
  { text: 'SELECT', baseline: 0x94, cap: 24 },
] as const;
const TITLE_CENTRE = 184;
const TITLE_STYLE: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#ffffff'],
    [0.35, '#f4dceb'],
    [0.55, '#b98aa8'],
    [0.75, '#e9cddf'],
    [1, '#7b5370'],
  ],
  outlines: [
    [0.05, '#120812'],
    [0.04, '#4a2c44'],
  ],
  tracking: 0.04,
  bevel: { x: 0.03, y: 0.04, colour: '#3a1d33' },
  shadow: { x: 0.03, y: 0.06, blur: 0.1, colour: 'rgba(0, 0, 0, 0.8)' },
};

const NAME_STYLE: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#ffffff'],
    [0.6, '#e8e8e8'],
    [1, '#b8b8b8'],
  ],
  outlines: [[0.14, '#000000']],
  tracking: 0.05,
  shadow: { x: 0.05, y: 0.08, blur: 0.1, colour: 'rgba(0, 0, 0, 0.6)' },
};
const TIMER_STYLE: TypeStyle = {
  face: NUMERALS,
  fill: [
    [0, '#fff6b0'],
    [0.45, '#ffd800'],
    [1, '#d88a00'],
  ],
  outlines: [
    [0.025, '#000000'],
    [0.06, '#3a2200'],
  ],
  tracking: 0,
  shadow: { x: 0.03, y: 0.05, blur: 0.08, colour: 'rgba(0, 0, 0, 0.5)' },
};
const TAG_STYLE: TypeStyle = { face: DISPLAY, fill: [[0, '#ffffff'], [1, '#e0e0e0']], outlines: [[0.12, '#000000']], tracking: 0.04 };

/** A level that climbs to 255 and back over 512 steps. */
function triangle(value: number): number {
  value &= 0x1ff;
  return 0xff < value ? 0x1ff - value : value;
}

/** The original's columns start 8 pixels left of the screen (its first shows only 40 of its 48). */
const WALL_LEFT = -8;

/** The wall above the band, climbing: its rows from where the field's count has moved them, its tiles across the window, cut to the band. */
function drawWall(game: GameState, scenes: SceneTables, art: ScreenLayer, bandY: number): void {
  const scroll = Math.imul(game.world.vsyncSeen, -RISE) | 0;
  const across = (0x40 - (scroll >> 4)) & 0x3f;
  const first = 7 - (((scroll >> 4) - 1) >> 6);
  const { left, right } = art.edges;
  art.clip(AREA_TOP, bandY);
  for (let n = 0, y = AREA_TOP - across; y < bandY; n += 1, y += TILE.h) {
    const row = scenes.select.wall[(first + n) & 7]!;
    for (let k = Math.floor((left - WALL_LEFT) / TILE.w); WALL_LEFT + k * TILE.w < right; k += 1) {
      const tile = row[((k % 8) + 8) % 8]!;
      const picture = art.atlas.picture(`wall ${tile} ${art.kx} ${art.ky}`, TILE.w * art.kx, TILE.h * art.ky, (g, l, t) => paintWallTile(g, tile, l, t, art.kx, art.ky));
      if (picture !== null) art.put(picture, WALL_LEFT + k * TILE.w, y, TILE.w, TILE.h);
    }
  }
  art.clip(null);
}

/** The line the frame's painting starts at below the pillars' tops. */
const FRAME = { top: 240 } as const;

/** One window of the frame painted as a picture and placed at `x`, `w` units wide. */
/**
 * The frame across the window, painted as one in strips at most `STRIP` device pixels wide placed
 * edge to edge on whole pixels (the atlas is narrower than a wide window): from the band's
 * shoulders down, and the pillars' tops at the window's edges.
 */
const STRIP = 2048;
const PILLAR = { width: 12, foot: 85 } as const;

/**
 * The frame's pieces (its strips and the pillars' tops), each painted once for the window into a
 * canvas of its own and drawn into the atlas from there: painted ahead (`paintSelectAhead`), the
 * select's first frame only copies them, where their brushed metal took 140 ms at 5120 by 1440.
 * Only the window's current pieces are kept.
 */
const pieces = new Map<string, OffscreenCanvas>();

/** Each piece of the frame for `rows` in the art layer's window: its key, its span in units and lines. */
function framePieces(art: ScreenLayer, rows: number): { key: string; from: number; to: number; lineFrom: number; lineTo: number }[] {
  const edges = art.edges;
  const { kx, ky } = art;
  const piece = (name: string, from: number, to: number, lineFrom: number, lineTo: number) => ({ key: `frame ${rows} ${name} ${edges.left} ${kx} ${ky}`, from, to, lineFrom, lineTo });
  const width = Math.round((edges.right - edges.left) * kx);
  const all = [];
  for (let at = 0; at < width; at += STRIP) all.push(piece(`strip ${at}`, edges.left + at / kx, edges.left + Math.min(width, at + STRIP) / kx, FRAME.top, 480));
  all.push(piece('pillar left', edges.left, edges.left + PILLAR.width, 0, PILLAR.foot));
  all.push(piece('pillar right', edges.right - PILLAR.width, edges.right, 0, PILLAR.foot));
  return all;
}

/** A piece of the frame painted on a canvas of its own, the first time it is asked for. */
function framePiece(art: ScreenLayer, rows: number, p: ReturnType<typeof framePieces>[number]): OffscreenCanvas {
  const found = pieces.get(p.key);
  if (found !== undefined) return found;
  const { kx, ky, edges } = art;
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil((p.to - p.from) * kx)), Math.max(1, Math.ceil((p.lineTo - p.lineFrom) * ky)));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (g !== null) paintSelectFrame(g, { left: 0, top: 0, from: p.from, to: p.to, lineFrom: p.lineFrom, lineTo: p.lineTo, kx, ky, edges }, rows);
  pieces.set(p.key, canvas);
  return canvas;
}

/** The frame's pieces painted ahead for the art layer's window (begun at its size), for one row and for two; those of another window dropped. */
export function paintSelectAhead(art: ScreenLayer): void {
  const wanted = [0, 1].flatMap((rows) => framePieces(art, rows).map((p) => [rows, p] as const));
  const keys = new Set(wanted.map(([, p]) => p.key));
  for (const key of [...pieces.keys()]) if (!keys.has(key)) pieces.delete(key);
  for (const [rows, p] of wanted) framePiece(art, rows, p);
}

function drawFrame(art: ScreenLayer, rows: number): void {
  for (const p of framePieces(art, rows)) {
    const picture = art.atlas.picture(p.key, (p.to - p.from) * art.kx, (p.lineTo - p.lineFrom) * art.ky, (g, left, top) => g.drawImage(framePiece(art, rows, p), left, top));
    if (picture !== null) art.put(picture, p.from, p.lineFrom, p.to - p.from, p.lineTo - p.lineFrom);
  }
}

/** A level of 256 as the GPU shades by it: its 0x7f7f7f scaled, over the 128 a texel is multiplied by at full. */
const shade = (level: number): Rgb => {
  const v = Math.min(0xff, (0x7f * level) >> 8) / 128;
  return [v, v, v];
};

/**
 * A side's portrait in its three bands, as the original lays them: a band at full drawn as it is;
 * a fading one taken away through a white palette (its ink times its level, shaded from its top to
 * its bottom) and then added (its texels times the same level), so it crossfades into the bright
 * light behind it, and all of it faded in over 28 frames once chosen; mirrored when it faces the
 * other way. An empty side's silhouette is only taken away from the light, its texels times its
 * level, a shadow.
 */
function drawPortrait(game: GameState, scenes: SceneTables, light: LightLayer, pictures: SelectPictures, n: number, top: number): void {
  const side = game.select.sides[n]!;
  const look = lookOf(scenes, side.shownRoster, side.shownCostume);
  const number = look & 0x1f;
  const x = scenes.select.sides[n]!.portraitX;
  const fade = side.fade !== 0 ? 0x20 - side.fade : 0x20;
  const [w, h] = [Math.round(PORTRAIT.w * light.kx), Math.round(PORTRAIT.h * light.ky)];
  const picture = light.atlas.picture(`portrait ${number} ${w} ${h}`, w, h, (g, left, t) =>
    paintOriginal(g, pictures.portraits, (number % PORTRAIT.columns) * PORTRAIT.cellW, Math.floor(number / PORTRAIT.columns) * PORTRAIT.cellH, PORTRAIT.w, PORTRAIT.h, left, t, w, h),
  );
  if (picture === null) return;
  const { u0, v0, u1, v1 } = picture.uv;
  const [left, right] = side.mirrored === 1 ? [u1, u0] : [u0, u1];
  const bands = BANDS[(look & 0xff) >> 6]!;
  let y = 0;
  bands.forEach((height, band) => {
    const level = (EDGES[band]! * fade) >> 5;
    const bottom = (EDGES[band + 1]! * fade) >> 5;
    const texels = { slot: picture.slot, uv: { u0: left, u1: right, v0: v0 + ((v1 - v0) * y) / PORTRAIT.h, v1: v0 + ((v1 - v0) * (y + height)) / PORTRAIT.h } };
    const at = top + y;
    y += height;
    if (height === 0 || (level === 0 && bottom === 0)) return;
    if (number === SILHOUETTE) {
      light.quad('subtract', x, at, PORTRAIT.w, height, shade(level), shade(bottom), texels);
      return;
    }
    if (level === bottom && 0xff < level) {
      light.quad('over', x, at, PORTRAIT.w, height, [1, 1, 1], [1, 1, 1], texels);
      return;
    }
    light.quad('subtract', x, at, PORTRAIT.w, height, shade(level), shade(bottom), texels, true);
    light.quad('add', x, at, PORTRAIT.w, height, shade(level), shade(bottom), texels);
  });
}

export function drawSelect(game: GameState, scenes: SceneTables, roster: RosterTables, art: ScreenLayer, light: LightLayer, text: ScreenLayer, pictures: SelectPictures): void {
  const select = game.select;
  if (select.frames <= 2) return;
  const rows = select.twoRows;
  const layout = scenes.select.layouts[rows]!;
  /* Black above the band, the truss climbing in it, the title over it. */
  const { left, right } = art.edges;
  art.fill(left, 0, right - left, layout.bandY, [0, 0, 0, 1]);
  drawWall(game, scenes, art, layout.bandY);
  art.clip(AREA_TOP, layout.bandY);
  for (const line of TITLE_LINES) {
    const set = art.type('select title', line.text, TITLE_STYLE, line.cap);
    if (set !== null) art.put(set.picture, TITLE_CENTRE - set.picture.width / 2 / art.kx, line.baseline - set.baseline / art.ky);
  }
  art.clip(null);
  /* The columns of light behind the portraits, added over the wall: from black to the character's colour, then to grey. */
  select.sides.forEach((side, n) => {
    const look = lookOf(scenes, side.shownRoster, side.shownCostume);
    const colour: Rgb = [((look >>> 8) & 0xff) / 0xff, ((look >>> 16) & 0xff) / 0xff, (look >>> 24) / 0xff];
    const grey = LIGHT.grey / 0xff;
    const x = scenes.select.sides[n]!.portraitX;
    const y = layout.portraitTop;
    light.quad('add', x, y - LIGHT.above, PORTRAIT.w, LIGHT.full + LIGHT.above, [0, 0, 0], colour);
    light.quad('add', x, y + LIGHT.full, PORTRAIT.w, LIGHT.end - LIGHT.full, colour, [grey, grey, grey]);
  });
  /* The floor under the band, seen through the slot; the pillars and the panel. */
  art.ramp(
    [
      [0, 'rgb(0, 0, 0)'],
      [1, rows === 0 ? 'rgb(0, 0, 0)' : `rgb(${FLOOR.red}, 0, 0)`],
    ],
    left,
    layout.bandY + FLOOR.below,
    right - left,
    480 - layout.bandY - FLOOR.below,
  );
  drawFrame(art, rows);
  /*
   * The grid's characters: big icons in one row, small ones in two; where a row shows eleven its
   * cells are closer, and the icons and cursors are made smaller by as much, about their middles.
   */
  const scale = cellStep(select.cells) / CELL_STEP;
  const iconHeight = rows === 0 ? ICON.big : ICON.small;
  const iconTop = (cell: { y: number }): number => cell.y + layout.gridDown + (iconHeight * (1 - scale)) / 2;
  for (const cell of select.cells) {
    if (cell.shows === 0 || cell.roster === NO_ONE) continue;
    const sheet = rows === 0 ? pictures.bigIcons : pictures.smallIcons;
    const icon = art.original(`icon ${rows} ${cell.roster}`, sheet, cell.roster * ICON.w, 0, ICON.w, iconHeight, ICON.w, iconHeight);
    if (icon !== null) art.put(icon, cell.x, iconTop(cell), ICON.w * scale, iconHeight * scale);
  }
  for (const n of [0, 1]) drawPortrait(game, scenes, light, pictures, n, layout.portraitTop);
  /* The cursors and their tags. */
  select.sides.forEach((side, n) => {
    if (side.cursor === 0) return;
    const cell = select.cells[side.cell];
    if (cell === undefined || cell.shows === 0) return;
    const pulsing = side.cursor === 1 || side.cursor === 3;
    const level = pulsing ? triangle(game.world.vsyncSeen << 4) / 0xff : 0x80 / 0xff;
    const partner = side.cursor === 3 || side.cursor === 4;
    const colour = SIDE_COLOURS[n]![partner ? 1 : 0];
    const x = cell.x - CURSOR.left * scale;
    const y = iconTop(cell);
    const top = y + layout.cursorTop * scale;
    const w = CURSOR.half * 2 * scale;
    const h = layout.cursorHeight * scale;
    text.setAlpha(0.35 + 0.65 * level);
    const ring = text.atlas.picture(`cursor ${colour} ${w} ${h} ${text.ky}`, w * text.kx, h * text.ky, (g, left, t) => {
      const [pw, ph] = [w * text.kx, h * text.ky];
      const line = Math.max(2, text.ky * 1.4);
      g.strokeStyle = colour;
      g.lineWidth = line;
      g.shadowColor = colour;
      g.shadowBlur = line * 2;
      g.strokeRect(left + line, t + line, pw - line * 2, ph - line * 2);
    });
    if (ring !== null) text.put(ring, x, top, w, h);
    text.setAlpha(1);
    const tag = `${partner ? 2 - n : n + 1}P`;
    const plate = text.atlas.picture(`tag ${colour} ${tag} ${text.ky}`, CURSOR.tagW * text.kx, CURSOR.tagH * text.ky, (g, left, t) => {
      g.fillStyle = colour;
      g.beginPath();
      g.roundRect(left, t, CURSOR.tagW * text.kx, CURSOR.tagH * text.ky * 0.8, text.ky * 2);
      g.fill();
    });
    const tagX = x + scenes.select.sides[n]!.cursorOffset * scale;
    const tagY = y + layout.tagY * scale;
    if (plate !== null) text.put(plate, tagX, tagY);
    text.text(`tag ${n}`, tag, TAG_STYLE, CURSOR.tagH * 0.5, tagX + 2, tagY + CURSOR.tagH * 0.62);
  });
  /* The names under the portraits. */
  select.sides.forEach((side, n) => {
    if (side.nameKind !== 1 && side.nameKind !== 2) return;
    if (side.shownRoster === NO_ONE) return;
    const name = roster.codes[side.shownRoster * 4 + side.shownCostume]?.name ?? '';
    if (name === '') return;
    const set = text.type('select name', name, NAME_STYLE, NAME.cap);
    if (set !== null) text.put(set.picture, scenes.select.sides[n]!.nameCentre - set.picture.width / 2 / text.kx, layout.nameY + NAME.baseline - set.baseline / text.ky);
  });
  /* The countdown, two digits. */
  const value = Math.floor((select.countdown + select.perCount - 1) / Math.max(1, select.perCount));
  [value % 10, Math.floor(value / 10) % 10].forEach((digit, k) => {
    const set = text.type('select timer', String(digit), TIMER_STYLE, TIMER.cap);
    const x = TIMER.ones - k * TIMER.step;
    if (set !== null) text.put(set.picture, x + TIMER.w / 2 - set.picture.width / 2 / text.kx, layout.timerY + TIMER.baseline - set.baseline / text.ky);
  });
  /* An arrival's arrows, pulsing at the band's ends while a side chooses. */
  if (select.arrivals !== 0 && (select.sides[0]!.state < SideState.COMPUTER || select.sides[1]!.state < SideState.COMPUTER)) {
    const frame = game.world.vsyncSeen & 0x1f;
    const level = Math.min(frame * 0x10, 0x1ff - frame * 0x10) / 0xff;
    const swing = Math.min(frame, 0x1f - frame) >> 1;
    const y = layout.bandY - ARROWS.above;
    text.setAlpha(level);
    for (const [x, pointing] of [
      [ARROWS.left - swing, -1],
      [ARROWS.right + swing, 1],
    ] as const) {
      const arrow = text.atlas.picture(`arrow ${pointing} ${text.ky}`, ARROWS.w * text.kx, ARROWS.h * text.ky, (g, left, t) => {
        const [w, h] = [ARROWS.w * text.kx, ARROWS.h * text.ky];
        g.fillStyle = '#ffffff';
        g.beginPath();
        if (pointing < 0) {
          g.moveTo(left, t + h / 2);
          g.lineTo(left + w, t);
          g.lineTo(left + w, t + h);
        } else {
          g.moveTo(left + w, t + h / 2);
          g.lineTo(left, t);
          g.lineTo(left, t + h);
        }
        g.fill();
      });
      if (arrow !== null) text.put(arrow, x, y, ARROWS.w, ARROWS.h);
    }
    text.setAlpha(1);
  }
  for (const run of game.printed) text.print(run);
  /* The sparkles, added: white at their heads and blue at their tails, cut above the band. */
  light.clip(AREA_TOP, layout.bandY - SPARKLE.cut);
  for (const sparkle of select.sparkles) {
    if (sparkle.on !== 1) continue;
    const level = Math.max(0, sparkle.level & 0xff) / 0xff;
    light.quad('add', sparkle.x, sparkle.y, 1, SPARKLE.height, [level, level, level], [0, 0, level]);
  }
  light.clip(null);
}
