/**
 * The versus select, drawn new on the original's design across the whole window: black under the
 * mode's two colours (bars at the title's ends, a floor rising to near white, and two columns of
 * light added beside the grid), the game's name in gold and the tournament's line scrolling
 * behind, the grid's characters in their frames as the original has their icons, each side's
 * cursor and tag, its slot, the bar of its costume under its name, versus's panel and each side's
 * handicap gauge, the printer's lines (kept to the original's screen, where its gauges and lines
 * slide in from beyond its edges), and the fade in.
 */
import type { SceneTables, VsSelectQuad } from '../../sim/data/scenes.ts';
import { MenuMode } from '../../sim/game/menu.ts';
import { printRuns } from '../../sim/game/printer.ts';
import type { GameState, VsSelectSide } from '../../sim/game/state.ts';
import { codeUnder, NO_CHOICE, slotOf, TAKEN, VsSideState } from '../../sim/game/vs-select.ts';
import { lightAcross, type LightLayer, type Rgb } from '../2d/light.ts';
import type { TypeStyle } from '../2d/type.ts';
import { DISPLAY } from '../2d/typefaces.ts';
import { drawFrame, drawIcon, FRAME, SETS } from './icons.ts';
import { SCREEN, type ScreenLayer } from './screen.ts';

/** Team Battle's panel behind a side's slots, and the mark under its size: the numbers' step, the mark's line and width. */
const TEAM_PANEL = { w: 0x90, h: 0x80, step: 0x10, under: 0x34, mark: 0x11 } as const;
/** A slot's step to the next (four to a row). */
const SLOT_STEP = { x: 0x24, y: 0x40 } as const;
/** The colour sets of a cursor over a character not to be chosen, and of practice's partner. */
const UNAVAILABLE_SET = 0;
const PARTNER_SET = 3;
/** The cursor kinds: none, choosing, chosen, partner choosing, partner chosen. */
const CURSOR = { choosing: 1, chosen: 2, partner: 3, partnerChosen: 4 } as const;
/** A tag over a cursor: its size and how far above the cell it sits. */
const TAG = { w: 0x14, h: 0x10, above: 4 } as const;
/** The costumes' bars under a name: its height, and the colours by costume. */
const BAR = { h: 10, colours: ['#e03850', '#408088', '#e0a008', '#506070'] } as const;
/** The game's name: its seven letters, a cell each, the strip's line, height and period. */
const STRIP = { letters: 'TEKKEN3', cell: 0x30, y: 0x5f, h: 0x50, period: 0x180, cap: 52 } as const;
/** The tournament's line: its period, font, colour and line. */
const LINE = { period: 0x344, font: 2, colour: 6, y: 0xcb } as const;
/** Versus's panel (taken away from the picture): its middle, its sides fading, and the tab below it. */
const PANEL = { x: 0x58, y: 0x13b, w: 0xc0, h: 0x50, fade: 0x28, level: 0x40 / 0xff, tab: { top: [0x9a, 0xd6], bottom: [0xa6, 0xca], y: 0x18b, h: 0x16 } } as const;
/** The handicap gauge: its frame's width and height, the segments' line and height, the frame's colours, the segments' lit and unlit colours (the first four, then the rest). */
const GAUGE = { w: 0x80, h: 0x18, top: 4, segment: 0x10, frame: ['#0a2a28', '#50f8f0'], lit: ['#28e0d8', '#f8e050'], unlit: ['#700000', '#303030'] } as const;

const GOLD: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#fff4c0'],
    [0.4, '#e0b040'],
    [0.6, '#8a5a10'],
    [1, '#d8a030'],
  ],
  outlines: [[0.06, '#2a1800']],
  tracking: 0,
  shadow: { x: 0.03, y: 0.05, blur: 0.08, colour: 'rgba(0, 0, 0, 0.6)' },
};
const TAG_STYLE: TypeStyle = { face: DISPLAY, fill: [[0, '#ffffff'], [1, '#e0e0e0']], outlines: [[0.12, '#000000']], tracking: 0.04 };

/** A colour 0xbbggrr as red, green and blue of 1. */
const rgb = (colour: number): Rgb => [(colour & 0xff) / 0xff, ((colour >> 8) & 0xff) / 0xff, ((colour >> 16) & 0xff) / 0xff];
const css = ([r, g, b]: Rgb): string => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
/** A level that climbs to 255 and back over 512 steps. */
function triangle(value: number): number {
  value &= 0x1ff;
  return 0xff < value ? 0x1ff - value : value;
}

/** A quad's colours, all ones read as the mode's colour. */
const quadColours = (quad: VsSelectQuad, mode: number): Rgb[] => quad.colours.map((c) => rgb(c === 0xffffffff ? mode : c));

/** An opaque quad as a ramp across or down, a side at the screen's edge carried out to the window's. */
function drawOpaque(art: ScreenLayer, quad: VsSelectQuad, mode: number): void {
  const [c0, c1, c2] = quadColours(quad, mode);
  const { x: x0, y: y0 } = quad.corners[0]!;
  const { x: x1, y: y1 } = quad.corners[3]!;
  const { left, right } = art.edges;
  const from = x0 <= 0 ? left : x0;
  const to = SCREEN.width <= x1 ? right : x1;
  const across = c0!.every((v, k) => v === c2![k]);
  if (across) art.ramp([[0, css(c0!)], [1, css(c1!)]], from, y0, to - from, y1 - y0, true);
  else art.ramp([[0, css(c0!)], [1, css(c2!)]], from, y0, to - from, y1 - y0);
}

/** The tournament's line and the game's name, each scrolled to its place and repeated across the window; the name `shade` as bright. */
export function drawScrolls(art: ScreenLayer, tournament: string, line: number, strip: number, shade = 1): void {
  const { left, right } = art.edges;
  for (let x = firstRound(line - LINE.period, LINE.period, left); x < right; x += LINE.period) {
    for (const run of printRuns(LINE.font, LINE.colour, x, LINE.y, tournament, 0).runs) art.print(run);
  }
  art.setShade(shade);
  for (let start = firstRound(strip - STRIP.period, STRIP.period, left); start < right; start += STRIP.period) {
    [...STRIP.letters].forEach((letter, k) => {
      const x = start + k * STRIP.cell;
      if (x + STRIP.cell < left || right < x) return;
      const set = art.type('vs strip', letter, GOLD, STRIP.cap);
      if (set !== null) art.put(set.picture, x + STRIP.cell / 2 - set.picture.width / 2 / art.kx, STRIP.y + STRIP.h / 2 - set.picture.height / 2 / art.ky);
    });
  }
  art.setShade(1);
}

/** The opaque quads of the select's background in `colour` (0xbbggrr) over black across the window. */
export function drawOpaqueQuads(art: ScreenLayer, quads: readonly VsSelectQuad[], colour: number): void {
  const { left, right } = art.edges;
  art.fill(left, 0, right - left, SCREEN.lines, [0, 0, 0, 1]);
  for (const quad of quads) drawOpaque(art, quad, colour);
}

/** Where a thing repeated every `period` from `at` starts its first round wholly left of `left`. */
function firstRound(at: number, period: number, left: number): number {
  while (left - period < at) at -= period;
  return at;
}

/** The background: black, the mode's bars and floor, versus's panel, the tournament's line and the game's name scrolling, the columns of light. */
function drawBackdrop(game: GameState, scenes: SceneTables, art: ScreenLayer, light: LightLayer): void {
  const t = scenes.vsSelect;
  const vs = game.vsSelect;
  const [first, second] = t.modeColours[vs.mode] ?? t.modeColours[0]!;
  drawOpaqueQuads(art, t.opaque, first);
  if (vs.mode === MenuMode.VERSUS) {
    const level: Rgb = [PANEL.level, PANEL.level, PANEL.level];
    light.quad('subtract', PANEL.x, PANEL.y, PANEL.w, PANEL.h, level, level);
    lightAcross(light, 'subtract', PANEL.x - PANEL.fade, PANEL.y, PANEL.fade, PANEL.h, level, true);
    lightAcross(light, 'subtract', PANEL.x + PANEL.w, PANEL.y, PANEL.fade, PANEL.h, level, false);
    /* The tab under the panel, narrowing down. */
    const { top, bottom, y, h } = PANEL.tab;
    for (let line = 0; line < h; line += 2) {
      const k = line / h;
      const from = top[0] + (bottom[0] - top[0]) * k;
      const to = top[1] + (bottom[1] - top[1]) * k;
      light.quad('subtract', from, y + line, to - from, 2, level, level);
    }
  }
  drawScrolls(art, t.tournament, vs.line, vs.strip);
  /* The columns of light beside the grid, in the mode's second colour. */
  const added = rgb(second);
  t.added.forEach((quad) => {
    const { x: x0, y: y0 } = quad.corners[0]!;
    const { x: x1, y: y1 } = quad.corners[3]!;
    const fullAtRight = quad.colours[1] === 0xffffffff;
    lightAcross(light, 'add', x0, y0, x1 - x0, y1 - y0, added, fullAtRight);
  });
}

/** The grid: each cell's character, or the empty icon where not earned; a cell whose character a choosing cursor's side has chosen already, darker. */
function drawGrid(game: GameState, scenes: SceneTables, art: ScreenLayer, smallIcons: ImageBitmap): void {
  const t = scenes.vsSelect;
  const under = game.vsSelect.sides.map((side) => (side.cursor === CURSOR.choosing ? { code: t.grid[side.column + side.row * 7]!.code, seen: codeUnder(game, scenes, side) } : { code: TAKEN, seen: TAKEN }));
  if (under[0]!.code === under[1]!.code && (under[0]!.seen !== TAKEN || under[1]!.seen !== TAKEN)) for (const u of under) u.code = TAKEN;
  const dimmed = under.map((u) => (u.seen === TAKEN ? u.code : TAKEN));
  for (const cell of t.grid) {
    const earned = (game.records.earnedRoster & (1 << (cell.code >> 2))) !== 0;
    drawIcon(art, smallIcons, cell.x, cell.y, earned ? cell.code : TAKEN, dimmed.includes(cell.code));
  }
}

/** Each side's slot: what its kind shows (the character under its cursor, a frame waiting, or its choices). */
function drawSlots(game: GameState, scenes: SceneTables, art: ScreenLayer, smallIcons: ImageBitmap): void {
  const vs = game.vsSelect;
  vs.sides.forEach((side, n) => {
    const slot = scenes.vsSelect.sides[n]!.slots[slotOf(vs.mode)]!;
    if (vs.mode === MenuMode.TEAM_BATTLE) {
      art.fill(slot.x, slot.y, TEAM_PANEL.w, TEAM_PANEL.h, [0, 0, 0, 0.5]);
      if (side.nameKind === 1) art.fill(slot.x + 8 + (side.teamSize - 1) * TEAM_PANEL.step - 2, slot.y + TEAM_PANEL.under, TEAM_PANEL.mark, 4, [1, 0, 0, 1]);
    }
    for (let k = 0; k < side.teamSize; k += 1) {
      const x = slot.x + (k & 3) * SLOT_STEP.x;
      const y = slot.y + (k >> 2) * SLOT_STEP.y;
      let code = Math.min(side.chosen[k]!, NO_CHOICE);
      if (side.slotKind === 1) {
        drawFrame(art, x, y, 0, 0x80);
        continue;
      }
      if (side.slotKind === 2 && k === side.count) {
        drawFrame(art, x, y, 0, triangle(game.world.vsyncSeen << 4));
        continue;
      }
      if (side.slotKind === 3 && k === side.count) code = Math.min(codeUnder(game, scenes, side), NO_CHOICE);
      drawIcon(art, smallIcons, x, y, code);
    }
  });
}

/** A side's cursor by its kind: its colour set and whether it pulses (while choosing), or none. */
function cursorLook(game: GameState, scenes: SceneTables, side: VsSelectSide, n: number): { set: number; pulsing: boolean } | null {
  const own = scenes.vsSelect.sides[n]!.cursor & 3;
  switch (side.cursor) {
    case CURSOR.choosing:
      return { set: codeUnder(game, scenes, side) < NO_CHOICE ? own : UNAVAILABLE_SET, pulsing: true };
    case CURSOR.chosen:
      return { set: own, pulsing: false };
    case CURSOR.partner:
      return { set: PARTNER_SET, pulsing: true };
    case CURSOR.partnerChosen:
      return { set: PARTNER_SET, pulsing: false };
    default:
      return null;
  }
}

/** The cursors over their cells, each a half its own where both are on one, and their tags. */
function drawCursors(game: GameState, scenes: SceneTables, text: ScreenLayer): void {
  const vs = game.vsSelect;
  const t = scenes.vsSelect;
  const shared = vs.sides[0]!.column === vs.sides[1]!.column && vs.sides[0]!.row === vs.sides[1]!.row;
  vs.sides.forEach((side, n) => {
    const look = cursorLook(game, scenes, side, n);
    if (look === null) return;
    const cell = t.grid[side.column + side.row * 7]!;
    const level = look.pulsing ? triangle(game.world.vsyncSeen << 4) : 0x80;
    if (shared && vs.sides[(n + 1) & 1]!.cursor !== 0) text.clipAcross(cell.x + (n === 0 ? 0 : FRAME.w / 2), cell.x + (n === 0 ? FRAME.w / 2 : FRAME.w));
    drawFrame(text, cell.x, cell.y, look.set, Math.max(0x40, level));
    text.clipAcross(null);
    const partner = side.cursor === CURSOR.partner || side.cursor === CURSOR.partnerChosen;
    const tagX = cell.x + t.sides[n]!.tags[partner ? 1 : 0];
    const tagY = cell.y - TAG.above;
    const [, stripe] = SETS[look.set]!;
    const plate = text.atlas.picture(`vs tag ${stripe} ${text.ky}`, TAG.w * text.kx, TAG.h * text.ky, (g, left, top) => {
      g.fillStyle = stripe;
      g.beginPath();
      g.roundRect(left, top, TAG.w * text.kx, TAG.h * text.ky * 0.8, text.ky * 2);
      g.fill();
    });
    if (plate !== null) text.put(plate, tagX, tagY);
    text.text(`vs tag ${n}`, `${partner ? 2 - n : n + 1}P`, TAG_STYLE, TAG.h * 0.5, tagX + 2, tagY + TAG.h * 0.62);
  });
}

/** Each side's handicap gauge: its frame, black inside, its segments lit to its handicap; pulsing while its side sets it. */
function drawGauges(game: GameState, scenes: SceneTables, art: ScreenLayer): void {
  const t = scenes.vsSelect;
  art.clipAcross(0, SCREEN.width);
  game.vsSelect.sides.forEach((side, n) => {
    const gauge = t.sides[n]!.gauge;
    const mirrored = gauge.mirrored === 1;
    const x = side.gaugeX;
    const y = gauge.y;
    const frameX = mirrored ? x : x - GAUGE.w;
    const level = side.state === VsSideState.HANDICAP ? 0.5 + triangle(game.world.vsyncSeen << 4) / 0x1ff : 0.75;
    const frame = parseInt(GAUGE.frame[1].slice(1), 16);
    art.fill(frameX, y, GAUGE.w, GAUGE.h, [0.04, 0.16, 0.16, 1]);
    art.fill(frameX, y, GAUGE.w, 2, [((frame >> 16) / 0xff) * level, (((frame >> 8) & 0xff) / 0xff) * level, ((frame & 0xff) / 0xff) * level, 1]);
    art.fill(frameX, y + GAUGE.h - 2, GAUGE.w, 2, [((frame >> 16) / 0xff) * level, (((frame >> 8) & 0xff) / 0xff) * level, ((frame & 0xff) / 0xff) * level, 1]);
    art.fill(frameX + 2, y + GAUGE.top, GAUGE.w - 4, GAUGE.segment, [0, 0, 0, 1]);
    let at = mirrored ? x + 2 : x - 1;
    t.segments.forEach((width, k) => {
      const lit = k === 0 || k <= side.handicap;
      const hex = (lit ? GAUGE.lit : GAUGE.unlit)[k < 4 ? 0 : 1];
      const v = parseInt(hex.slice(1), 16);
      const from = mirrored ? at : at - width;
      art.fill(from, y + GAUGE.top, width - 1, GAUGE.segment, [(v >> 16) / 0xff, ((v >> 8) & 0xff) / 0xff, (v & 0xff) / 0xff, 1]);
      at = mirrored ? at + width : at - width;
    });
  });
  art.clipAcross(null);
}

/** The bars of the costumes under the names. */
function drawBars(game: GameState, art: ScreenLayer): void {
  for (const side of game.vsSelect.sides) {
    if (side.bar.width === 0) continue;
    const v = parseInt(BAR.colours[side.bar.costume & 3]!.slice(1), 16);
    art.ramp(
      [
        [0, `rgba(${v >> 16}, ${(v >> 8) & 0xff}, ${v & 0xff}, 0.5)`],
        [0.5, BAR.colours[side.bar.costume & 3]!],
        [1, `rgba(${v >> 16}, ${(v >> 8) & 0xff}, ${v & 0xff}, 0.6)`],
      ],
      side.bar.x,
      side.bar.y,
      side.bar.width,
      BAR.h,
    );
  }
}

export function drawVsSelect(game: GameState, scenes: SceneTables, art: ScreenLayer, light: LightLayer, text: ScreenLayer, smallIcons: ImageBitmap): void {
  if (game.step < 2) return;
  drawBackdrop(game, scenes, art, light);
  drawGrid(game, scenes, art, smallIcons);
  drawSlots(game, scenes, art, smallIcons);
  if (game.vsSelect.mode === MenuMode.VERSUS) drawGauges(game, scenes, art);
  drawBars(game, art);
  drawCursors(game, scenes, text);
  text.clipAcross(0, SCREEN.width);
  for (const run of game.printed) if (run.layer !== 0) text.print(run);
  text.clipAcross(null);
  for (const { level } of game.fades) text.fade(level);
}
