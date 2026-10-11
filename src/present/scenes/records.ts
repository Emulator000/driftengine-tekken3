/**
 * The records screen's 2D over the circling stage: the ranking's title on a bar of brushed colour
 * running in from the window's left edge and fading out, drawn new on the original's (its colour
 * and title by ranking); under it the list, cut to its window: each row's rank, name and figures
 * in type (the printer's runs), the character's icon as the original has it, the grey rules, and
 * for the plays a bar in the character's colours, a box seen from above and its left, growing to
 * its share. The name entry's: the band darkening the stage behind the record's row, the seconds
 * left over the title's bar, and a red cursor under the name's next letter.
 */
import type { SceneTables } from '../../sim/data/scenes.ts';
import { BAND, CURSOR, Draws, namingMarks, Ranking, rowGrowth, rowLine } from '../../sim/game/records-screen.ts';
import { FONTS } from '../../sim/game/printer.ts';
import type { GameState, PrintRun } from '../../sim/game/state.ts';
import type { TypeStyle } from '../2d/type.ts';
import { DISPLAY } from '../2d/typefaces.ts';
import { printStyle } from '../hud/theme.ts';
import type { ScreenLayer } from './screen.ts';

/** The title's bar: its lines, where its colour gives way to steel, where it has faded out. */
const BAR = { top: 0x24, bottom: 0x54, colourTo: 0xf0, end: 0x170 } as const;
/** Each ranking's title and its bar's colours down it (dark top, bright, deepening to the foot). */
const TITLES = [
  { text: 'CHARACTER TIME RECORD', colours: ['#39215a', '#5a3194', '#6b4a9c', '#211039', '#100818'] },
  { text: 'GREATEST SURVIVORS', colours: ['#842908', '#ce4218', '#d65a31', '#521808', '#290800'] },
  { text: 'CHARACTERS', colours: ['#840810', '#ce1821', '#d63139', '#520808', '#290000'] },
] as const;
const TITLE = { left: 0x14, baseline: 0x48, cap: 22 } as const;
const TITLE_STYLE: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#ffffff'],
    [0.45, '#e9e9ee'],
    [0.6, '#a9acb8'],
    [1, '#f4f4f8'],
  ],
  outlines: [
    [0.06, '#0c0c10'],
    [0.035, '#3a3a44'],
  ],
  tracking: 0.04,
  shadow: { x: 0.04, y: 0.06, blur: 0.06, colour: 'rgba(0, 0, 0, 0.7)' },
};
/** The list's window: the draw area the game sets for it (from line 0x60, 0x168 lines down; 0x170 under the name entry). */
const WINDOW = { top: 0x60, bottom: 0x60 + 0x168 } as const;
const NAMING_WINDOW = { top: 0x60, bottom: 0x60 + 0x170 } as const;
/** The lit row's band: half black over the picture, with the original's touch of blue. */
const BAND_SHADE = [0, 0, 0x10 / 0xff, 0.5] as const;
/**
 * The name entry's marks in a glyph's cell (the printer's font 1, its capitals 18 lines high): the
 * back mark's outline (its corners, the box they fill and the room left for its rings), and the
 * end mark's letters (each one's left and baseline) and their capitals' height.
 */
const GLYPH_CAP = 18;
const BACK_MARK = {
  points: [
    [1, 14.5],
    [1.5, 12.5],
    [8, 6],
    [8, 10.5],
    [14, 10.5],
    [14, 14.5],
  ],
  left: 1,
  top: 6,
  w: 13,
  h: 8.5,
  pad: 2,
} as const;
const END_MARK = {
  cap: 9,
  letters: [
    { letter: 'E', dx: 2.5, baseline: 11 },
    { letter: 'D', dx: 9, baseline: 21 },
  ],
} as const;
/** The cursor's red, and the light along its top. */
const CURSOR_RED = [0.86, 0.04, 0.03, 1] as const;
const CURSOR_LIGHT = [1, 0.45, 0.4, 0.9] as const;
/** A row's icon (the small one: its place from the row's line, its size), its rules' places and sizes, their grey. */
const ICON = { x: 0x4c, up: 0x3a, w: 0x20, h: 0x3a } as const;
const RULES = [
  { x: 8, up: 0xe, w: 0x3e, h: 8 },
  { x: 0x46, up: 8, w: 0x132 - 8, h: 2 },
] as const;
const GREY = [0.278, 0.278, 0.278, 1] as const;
/** A plays bar: its right end, its line above the row's, its height, the longest, how far its end and top reach back. */
const PLAYS_BAR = { right: 0x111, up: 0x22, h: 0x18, most: 0x81, back: 6, rise: 8 } as const;

const css = (colour: number): string => `rgb(${colour & 0xff}, ${(colour >> 8) & 0xff}, ${(colour >> 16) & 0xff})`;

/** The ranking's bar and title. */
function drawTitleBar(art: ScreenLayer, text: ScreenLayer, list: number): void {
  const title = TITLES[list] ?? TITLES[0];
  const { left } = art.edges;
  const [w, h] = [(BAR.end - left) * art.kx, (BAR.bottom - BAR.top) * art.ky];
  const picture = art.atlas.picture(`records bar ${list} ${Math.round(left)}`, w, h, (g, x0, y0) => {
    const along = (x: number): number => x0 + (x - left) * art.kx;
    const down = g.createLinearGradient(0, y0, 0, y0 + h);
    title.colours.forEach((c, i) => down.addColorStop(i / (title.colours.length - 1), c));
    g.fillStyle = down;
    g.fillRect(x0, y0, along(BAR.colourTo) - x0, h);
    /* The steel the colour gives way to, fading out toward the end. */
    const steel = g.createLinearGradient(0, y0, 0, y0 + h);
    steel.addColorStop(0, '#606060');
    steel.addColorStop(0.35, '#3a3a3a');
    steel.addColorStop(1, '#101010');
    g.fillStyle = steel;
    g.fillRect(along(BAR.colourTo), y0, along(BAR.end) - along(BAR.colourTo), h);
    const blend = g.createLinearGradient(along(BAR.colourTo - 0x30), 0, along(BAR.colourTo + 0x10), 0);
    blend.addColorStop(0, 'rgba(0, 0, 0, 0)');
    blend.addColorStop(1, 'rgba(40, 40, 44, 1)');
    g.fillStyle = blend;
    g.fillRect(along(BAR.colourTo - 0x30), y0, (0x40 * art.kx), h);
    /* Brushed: fine light and dark streaks along it. */
    let seed = 0x5eed + list;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < h * 1.5; i += 1) {
      const y = y0 + random() * h;
      g.strokeStyle = random() < 0.5 ? `rgba(255, 255, 255, ${0.03 + random() * 0.08})` : `rgba(0, 0, 0, ${0.05 + random() * 0.1})`;
      g.lineWidth = 0.5 + random();
      const x = x0 + random() * w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w * (0.1 + random() * 0.4), y);
      g.stroke();
    }
    /* Lit along its top, shadowed along its foot. */
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fillRect(x0, y0, w, Math.max(1, art.ky));
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.fillRect(x0, y0 + h - Math.max(1, art.ky), w, Math.max(1, art.ky));
    /* The end fading out. */
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(along(BAR.end - 0x70), 0, along(BAR.end), 0);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
    g.fillStyle = fade;
    g.fillRect(along(BAR.end - 0x70), y0, 0x70 * art.kx, h);
    g.globalCompositeOperation = 'source-over';
  });
  if (picture !== null) art.put(picture, left, BAR.top, BAR.end - left, BAR.bottom - BAR.top);
  text.text('records title', title.text, TITLE_STYLE, TITLE.cap, TITLE.left, TITLE.baseline);
}

/** A plays bar growing from its right end: its face shaded across in the character's colours, its end and its top seen from the left and above. */
function drawPlaysBar(art: ScreenLayer, colours: readonly number[], permille: number, y: number): void {
  const length = permille === 0 ? 0 : Math.trunc((Math.min(permille, 1000) * PLAYS_BAR.most) / 1000);
  if (length === 0) return;
  const key = `records bar ${colours.join(' ')} ${length}`;
  const [left, right, top, bottom] = [PLAYS_BAR.right - length - PLAYS_BAR.back, PLAYS_BAR.right, y - PLAYS_BAR.rise, y + PLAYS_BAR.h];
  const [w, h] = [(right - left) * art.kx, (bottom - top) * art.ky];
  const picture = art.atlas.picture(key, w, h, (g, x0, y0) => {
    const X = (x: number): number => x0 + (x - left) * art.kx;
    const Y = (line: number): number => y0 + (line - top) * art.ky;
    const face = g.createLinearGradient(X(right - length), 0, X(right), 0);
    face.addColorStop(0, css(colours[1]!));
    face.addColorStop(1, css(colours[2]!));
    g.fillStyle = face;
    g.fillRect(X(right - length), Y(y), length * art.kx, PLAYS_BAR.h * art.ky);
    /* The end, slanting back. */
    g.fillStyle = css(colours[0]!);
    g.beginPath();
    g.moveTo(X(left), Y(top));
    g.lineTo(X(right - length), Y(y));
    g.lineTo(X(right - length), Y(bottom));
    g.lineTo(X(left), Y(y + PLAYS_BAR.h - PLAYS_BAR.rise));
    g.closePath();
    g.fill();
    /* The top, seen from above. */
    const lid = g.createLinearGradient(X(left), 0, X(right), 0);
    lid.addColorStop(0, css(colours[3]!));
    lid.addColorStop(1, css(colours[4]!));
    g.fillStyle = lid;
    g.beginPath();
    g.moveTo(X(left), Y(top));
    g.lineTo(X(right - PLAYS_BAR.rise), Y(top));
    g.lineTo(X(right), Y(y));
    g.lineTo(X(right - length), Y(y));
    g.closePath();
    g.fill();
    /* A lit edge along the face's top. */
    g.fillStyle = 'rgba(255, 255, 255, 0.25)';
    g.fillRect(X(right - length), Y(y), length * art.kx, Math.max(1, art.ky));
  });
  if (picture !== null) art.put(picture, left, top, right - left, bottom - top);
}

/** The records screen's 2D, on the fields it draws (its record says what: nothing, the title's bar, the list too, or the name entry over it). */
export function drawRecords(game: GameState, scenes: SceneTables, art: ScreenLayer, text: ScreenLayer, smallIcons: ImageBitmap): void {
  const screen = game.recordsScreen;
  if (screen.draws === Draws.BLACK || Draws.NAMED < screen.draws) return;
  const naming = screen.draws === Draws.NAMING || screen.draws === Draws.NAMED;
  const marks = namingMarks(game);
  /* The lit row's band, darkening the stage behind the row by half across the window. */
  if (marks.band !== null) {
    const { left, right } = art.edges;
    art.fill(left, marks.band, right - left, BAND.height, BAND_SHADE);
  }
  drawTitleBar(art, text, game.records.list);
  /* The name entry's seconds left, its first run, over the title's bar. */
  const runs = naming ? game.printed.slice(1) : game.printed;
  if (naming && game.printed[0] !== undefined) text.print(game.printed[0]);
  if (screen.draws !== Draws.TITLE) {
    const window = naming ? NAMING_WINDOW : WINDOW;
    art.clip(window.top, window.bottom);
    text.clip(window.top, window.bottom);
    for (let row = 0; row < screen.count; row += 1) {
      const y = rowLine(game, row);
      if (!(y >>> 0 < 0x228)) continue;
      const roster = game.records.list === Ranking.SURVIVORS ? game.records.survivors[screen.order[row]!]!.roster : screen.order[row]!;
      for (const rule of RULES) art.fill(rule.x, y - rule.up, rule.w, rule.h, GREY);
      const icon = art.original(`icon small ${roster}`, smallIcons, roster * ICON.w, 0, ICON.w, ICON.h, ICON.w, ICON.h);
      if (icon !== null) art.put(icon, ICON.x, y - ICON.up, ICON.w, ICON.h);
      if (game.records.list === Ranking.PLAYS && screen.largest !== 0) {
        const grown = rowGrowth(game, row);
        const bar = Math.trunc((screen.shares[roster]! * grown * 1000) / screen.largest) >> 6;
        drawPlaysBar(art, scenes.records.bars[roster]!, bar, y - PLAYS_BAR.up);
      }
    }
    for (const run of runs) printRun(text, run);
    art.clip(null);
    text.clip(null);
  }
  /* The cursor under the name's next letter, in front of the type. */
  if (marks.cursor !== null) drawCursor(text, marks.cursor[0], marks.cursor[1]);
  for (const { level } of game.fades) text.fade(level);
}

/**
 * A printed run, the name entry's two marks among its letters drawn as the font draws them, in
 * the run's colours: `<` (back) a barbed arrow pointing left, `=` (end) a small E over a small D.
 */
function printRun(text: ScreenLayer, run: PrintRun): void {
  if (!/[<=]/.test(run.text)) return text.print(run);
  const advance = FONTS[run.font]!.advance;
  const letters = [...run.text];
  let from = 0;
  const flush = (to: number): void => {
    while (from < to && letters[from] === ' ') from += 1;
    if (from < to) text.print({ ...run, x: run.x + from * advance, text: letters.slice(from, to).join('').trimEnd() });
  };
  letters.forEach((letter, i) => {
    if (letter !== '<' && letter !== '=') return;
    flush(i);
    const x = run.x + i * advance;
    if (letter === '<') drawBack(text, run, x);
    else drawEnd(text, run, x);
    from = i + 1;
  });
  flush(letters.length);
}

/** The back mark: a bar low across the glyph, barbed up at its left end, filled and ringed as the run's type is. */
function drawBack(text: ScreenLayer, run: PrintRun, x: number): void {
  const style = printStyle(run.font, run.colour);
  const { points, left, top, w, h, pad } = BACK_MARK;
  const [pw, ph] = [Math.round((w + pad * 2) * text.kx), Math.round((h + pad * 2) * text.ky)];
  const picture = text.atlas.picture(`records back ${run.colour} ${pw} ${ph}`, pw, ph, (g, x0, y0) => {
    const X = (u: number): number => x0 + (u - left + pad) * text.kx;
    const Y = (v: number): number => y0 + (v - top + pad) * text.ky;
    g.beginPath();
    points.forEach(([u, v], k) => (k === 0 ? g.moveTo(X(u), Y(v)) : g.lineTo(X(u), Y(v))));
    g.closePath();
    g.lineJoin = 'round';
    for (const [width, colour] of style.outlines) {
      g.lineWidth = width * GLYPH_CAP * text.ky * 2;
      g.strokeStyle = colour;
      g.stroke();
    }
    const fill = g.createLinearGradient(0, Y(top), 0, Y(top + h));
    for (const [at, colour] of style.fill) fill.addColorStop(at, colour);
    g.fillStyle = fill;
    g.fill();
  });
  if (picture !== null) text.put(picture, x + left - pad, run.y + top - pad, w + pad * 2, h + pad * 2);
}

/** The end mark: a small E high on the glyph's left and a small D low on its right, in the run's colours. */
function drawEnd(text: ScreenLayer, run: PrintRun, x: number): void {
  const style = printStyle(run.font, run.colour);
  for (const { letter, dx, baseline } of END_MARK.letters) text.text(`records end ${run.colour}`, letter, style, END_MARK.cap, x + dx, run.y + baseline);
}

/** The name entry's cursor: a red bar under the letter, lit along its top. */
function drawCursor(text: ScreenLayer, x: number, y: number): void {
  text.fill(x, y, CURSOR.w, CURSOR.h, CURSOR_RED);
  text.fill(x, y, CURSOR.w, 1, CURSOR_LIGHT);
}
