/**
 * The results after a run, drawn on the original's pictures and design. Time Attack's: its
 * backdrop over its warm ground, each stage's row (a band darkening from its left, the opponent's
 * small picture, lit once its time is in), the runner's icon by the total, the printer's lines,
 * and the fades. Survival's: the versus select's backdrop in its own colour (the game's name
 * dimmed, a band darkened behind the tournament's line), each character beaten in its frame, the
 * printer's lines and the fades. Team Battle's: the same backdrop in its colour, each team's label
 * on its band of light, its row of members (those beaten dimmed, the one fighting in its side's
 * colour, empty places past its size), each bout's line between its two members (the one being
 * shown growing from the winner), the bouts' list with both members of each, the outcome on its
 * plate, the printer's lines and the fades. Tekken Force's: its backdrop, the human's portrait in
 * a lighter frame over a column of its light added into the backdrop, the bosses beaten (with Dr.
 * B earned before the run), the printer's lines and the fades.
 */
import type { SceneTables } from '../../sim/data/scenes.ts';
import { forceBossesShown, teamOutcome, teamsDrop } from '../../sim/game/results.ts';
import type { GameState } from '../../sim/game/state.ts';
import { lightAcross, type LightLayer, type Rgb } from '../2d/light.ts';
import { drawIcon, ICON, iconColumn } from './icons.ts';
import { paintOriginal, SCREEN, type ScreenLayer } from './screen.ts';
import { drawTitlePicture } from './title.ts';
import { COLUMN } from './versus-art.ts';
import { FRAME, FRAME_COLOUR, putPortrait } from './versus.ts';
import { drawOpaqueQuads, drawScrolls } from './vs-select.ts';

/** The original pictures the results show. */
export interface ResultsPictures {
  readonly results: ImageBitmap;
  readonly smallIcons: ImageBitmap;
}

/** The ground under Time Attack's backdrop. */
const GROUND: readonly [number, number, number, number] = [0xa0 / 0xff, 0x30 / 0xff, 0x20 / 0xff, 1];
/** A stage's row: its band (from its left, darkening by its level), its opponent's picture at half size and its glow once done. */
const BAND = { x: 0xd, y: 0x18, w: 0x80, h: 0x28, level: 0xde / 0xff } as const;
const MINI = { x: 0xf, y: 0x1e, w: 0x10, h: 0x1d, glow: 0.18 } as const;
/** The runner's icon beside the total. */
const RUNNER = { x: 0x121, y: 0x170 } as const;
const STAGES = 10;

/** A character's small picture at half its size, darker when `dim`. */
function drawMini(art: ScreenLayer, smallIcons: ImageBitmap, x: number, y: number, code: number, dim = false): void {
  const column = iconColumn(code);
  const picture = art.original(`icon small ${column}`, smallIcons, column * ICON.w, 0, ICON.w, ICON.h, ICON.w, ICON.h);
  if (picture === null) return;
  if (dim) art.setShade(0.5);
  art.put(picture, x, y, MINI.w, MINI.h);
  art.setShade(1);
}

export function drawTimeResults(game: GameState, scenes: SceneTables, art: ScreenLayer, light: LightLayer, text: ScreenLayer, pictures: ResultsPictures): void {
  if (game.step === 0) return;
  const r = game.results;
  const { left, right } = art.edges;
  art.fill(left, 0, right - left, SCREEN.lines, GROUND);
  drawTitlePicture(art, pictures.results, 1, 'results');
  const rows = Math.min(STAGES, r.counting !== 0 ? r.shown + 1 : r.shown);
  for (let stage = 0; stage < rows; stage += 1) {
    const { x, y } = scenes.results.stages[stage]!;
    lightAcross(light, 'subtract', x + BAND.x, y + BAND.y, BAND.w, BAND.h, [BAND.level, BAND.level, BAND.level], false);
    const opponent = game.run.opponents[stage]!;
    drawMini(art, pictures.smallIcons, x + MINI.x, y + MINI.y, (opponent.roster << 2) | opponent.costume);
    if (stage < r.shown) light.quad('add', x + MINI.x, y + MINI.y, MINI.w, MINI.h, [MINI.glow, MINI.glow, MINI.glow], [0, 0, 0]);
  }
  if (r.showTotal !== 0) drawIcon(art, pictures.smallIcons, RUNNER.x, RUNNER.y, r.code);
  for (const run of game.printed) text.print(run);
  for (const { level } of game.fades) text.fade(level);
}

/** Survival's backdrop: its colour, the game's name's brightness, the band behind the tournament's line and how much it darkens. */
const SURVIVAL = { colour: 0xa0c000, strip: 0x60 / 0x80, band: { y: 0xcb, h: 0x2a, level: 0x60 / 0xff } } as const;

export function drawSurvivalResults(game: GameState, scenes: SceneTables, art: ScreenLayer, light: LightLayer, text: ScreenLayer, smallIcons: ImageBitmap): void {
  if (game.step === 0) return;
  const r = game.results;
  drawOpaqueQuads(art, scenes.vsSelect.opaque, SURVIVAL.colour);
  const { left, right } = art.edges;
  const band = SURVIVAL.band;
  light.quad('subtract', left, band.y, right - left, band.h, [band.level, band.level, band.level], [band.level, band.level, band.level]);
  drawScrolls(art, scenes.vsSelect.tournament, r.scroll, r.strip, SURVIVAL.strip);
  for (let k = 0; k < r.shown; k += 1) {
    const { x, y } = scenes.results.beaten[k]!;
    drawIcon(art, smallIcons, x + 2, y + 2, r.beaten[k]! << 2);
  }
  for (const run of game.printed) if (run.layer !== 0) text.print(run);
  for (const { level } of game.fades) text.fade(level);
}

/** Team Battle's backdrop colour; each side's band of light under its label (from, solid from, solid to, to, its line and height, its colour); the rows' place; a bout's line's width and colours by its winner. */
const TEAM = {
  colour: 0x1830f0,
  bands: [
    { from: 0x10, solid: 0x10, end: 0x6c, to: 0xa8, y: 0x54, h: 0xe, colour: [0xff / 0xff, 0, 0] as Rgb },
    { from: 0xc8, solid: 0x100, end: 0x160, to: 0x160, y: 0x10c, h: 0xe, colour: [0xff / 0xff, 0xc0 / 0xff, 0] as Rgb },
  ],
  rows: { x: 0x28, step: 0x24, y: [100, 0xc0] },
  line: { x: 0x39, w: 3, top: 0xa4, bottom: 0xc0, colours: ['', '#f80000', '#f8e000', '#e0e0e0'] },
  list: { step: 0x60, row: 0x1e, y: 0x126, minis: [0x47, 0x6f], plate: { x: 0x28, w: 0x5f, h: 0x1d }, band: { x: 0x28, w: 0x5f, y: 0xf, h: 0xe } },
  plates: ['#c0c0c0', '#ff0000', '#ffc000'],
} as const;

export function drawTeamResults(game: GameState, scenes: SceneTables, art: ScreenLayer, light: LightLayer, text: ScreenLayer, smallIcons: ImageBitmap): void {
  if (game.step === 0) return;
  const r = game.results;
  const teams = game.world.match.teams;
  const bouts = game.run.team;
  const drop = teamsDrop(game);
  drawOpaqueQuads(art, scenes.vsSelect.opaque, TEAM.colour);
  const { left, right } = art.edges;
  const band = SURVIVAL.band;
  light.quad('subtract', left, band.y, right - left, band.h, [band.level, band.level, band.level], [band.level, band.level, band.level]);
  drawScrolls(art, scenes.vsSelect.tournament, r.scroll, r.strip, SURVIVAL.strip);
  /* Each label's band of light. */
  TEAM.bands.forEach((b, side) => {
    const y = b.y + (side === 1 ? drop : 0);
    if (b.from < b.solid) lightAcross(light, 'add', b.from, y, b.solid - b.from, b.h, b.colour, true);
    light.quad('add', b.solid, y, b.end - b.solid, b.h, b.colour, b.colour);
    if (b.end < b.to) lightAcross(light, 'add', b.end, y, b.to - b.end, b.h, b.colour, false);
  });
  /* The rows of members. */
  teams.forEach((team, side) => {
    const y = TEAM.rows.y[side]! + (side === 1 ? drop : 0);
    for (let k = 0; k < 8; k += 1) {
      const x = TEAM.rows.x + k * TEAM.rows.step;
      if (team.size <= k) {
        art.ramp([[0, 'rgb(0, 0, 0)'], [1, 'rgb(12, 12, 12)']], x + 1, y + 2, 0x22, 0x3c);
        art.fill(x, y, 0x24, 1, [0.19, 0.19, 0.19, 1]);
        art.fill(x, y + 0x3f, 0x24, 1, [0.19, 0.19, 0.19, 1]);
        continue;
      }
      const beaten = k < r.beatenSoFar[side]!;
      const fighting = k === r.beatenSoFar[side]! && k < Math.min(team.size, 8);
      drawIcon(art, smallIcons, x, y, team.members[k]!, beaten, true, fighting ? (side === 0 ? 2 : 1) : 0);
    }
  });
  /* Each bout's line between its two members, the one being shown growing from its winner. */
  const lineAt = (bout: number, grown: number): void => {
    const winner = bouts.bouts[bout]!;
    type Point = { x: number; y: number };
    const top: Point = { x: r.boutMembers[0]![bout]! * TEAM.rows.step + TEAM.line.x, y: TEAM.line.top };
    const bottom: Point = { x: r.boutMembers[1]![bout]! * TEAM.rows.step + TEAM.line.x, y: drop + TEAM.line.bottom };
    let [from, to]: [Point, Point] = [top, bottom];
    if (grown < 8) {
      const toward = (a: { x: number; y: number }, b: { x: number; y: number }, k: number) => ({ x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 });
      if (winner === 1) to = toward(top, bottom, grown);
      else if (winner === 2) from = toward(bottom, top, grown);
      else {
        const middle = toward(top, bottom, 4);
        [from, to] = [toward(middle, top, grown), toward(middle, bottom, grown)];
      }
    }
    drawLine(art, from, to, TEAM.line.w, TEAM.line.colours[winner] ?? '#e0e0e0');
  };
  const shown = Math.min(r.shown, bouts.bout);
  for (let bout = 0; bout < shown; bout += 1) lineAt(bout, 8);
  if (r.counting !== 0 && r.shown < bouts.bout) lineAt(r.shown, Math.min(r.counting, 8));
  /* The bouts' list: both members of each shown (the loser dimmed) on its plate, the rest's places dark. */
  const total = teams[0]!.size + teams[1]!.size - 1;
  for (let bout = 0; bout < Math.max(shown, total); bout += 1) {
    const x = (bout % 3) * TEAM.list.step;
    const y = Math.trunc(bout / 3) * TEAM.list.row + drop + TEAM.list.y;
    const { plate, band: line } = TEAM.list;
    art.fill(x + plate.x, y, plate.w, plate.h, [0, 0, 0, 1]);
    if (bout < shown) {
      const winner = bouts.bouts[bout]!;
      const colour = TEAM.plates[winner === 3 ? 0 : winner === 1 ? 1 : 2]!;
      art.ramp([[0, 'rgba(0, 0, 0, 1)'], [1, colour]], x + line.x, y + line.y, line.w, line.h, true);
      TEAM.list.minis.forEach((dx, side) => {
        const code = teams[side]!.members[r.boutMembers[side]![bout]!]!;
        const lost = winner === 3 ? false : winner !== side + 1;
        drawMini(art, smallIcons, x + dx, y, code, lost);
      });
    } else {
      art.ramp([[0, 'rgba(0, 0, 0, 1)'], [1, 'rgb(64, 64, 64)']], x + line.x, y + line.y, line.w, line.h, true);
      for (const dx of TEAM.list.minis) art.fill(x + dx, y, MINI.w, MINI.h, [0x10 / 0xff, 0x10 / 0xff, 0x20 / 0xff, 1]);
    }
  }
  /* The outcome's plate, once it has slid in. */
  if (r.showTotal !== 0 && r.wait === 0) {
    const { outcome } = teamOutcome(game);
    const [a, b] = r.left;
    const plate = a === b ? TEAM.plates[0] : b! < a! ? TEAM.plates[1] : TEAM.plates[2];
    const width = OUTCOME_WIDTHS[outcome]! * 22;
    const v = parseInt(plate!.slice(1), 16);
    art.fill(0xb8 - (width >> 1) - 8, Math.trunc(drop / 2) + 0x9c, width + 0x10, 0x2e, [(v >> 16) / 0xff, ((v >> 8) & 0xff) / 0xff, (v & 0xff) / 0xff, 0.5]);
  }
  for (const run of game.printed) if (run.layer !== 0) text.print(run);
  for (const { level } of game.fades) text.fade(level);
}

/** The outcomes' lines' lengths, for their plates. */
const OUTCOME_WIDTHS = [8, 9, 9, 14, 14] as const;

/** A line from one point to another, `w` units wide. */
function drawLine(art: ScreenLayer, from: { x: number; y: number }, to: { x: number; y: number }, w: number, colour: string): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const steps = Math.max(1, Math.ceil(length / 2));
  const v = parseInt(colour.slice(1), 16);
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    art.fill(from.x + dx * t, from.y + dy * t, w, 2, [(v >> 16) / 0xff, ((v >> 8) & 0xff) / 0xff, (v & 0xff) / 0xff, 1]);
  }
}

/** The pictures Tekken Force's results show: its backdrop, the portraits, the small icons. */
export interface ForceResultsPictures {
  readonly backdrop: ImageBitmap;
  readonly portraits: ImageBitmap;
  readonly smallIcons: ImageBitmap;
}

/** Tekken Force's portrait panel's place; its frame, lighter than the versus screen's; the bosses' row; the largest the backdrop is painted. */
const FORCE_PANEL = { x: 0x10, y: 0x64 } as const;
const FORCE_FRAME = (0xf0 / 0xe8) * FRAME_COLOUR[0];
const FORCE_BOSSES = { x: 0x34, step: 0x24, y: 0x17c } as const;
const MOST = 2040;
/** The run's flag that Dr. B was earned before it began, which shows the bosses. */
const FORCE_DR_B = 0x10;

const rgba = (c: readonly number[], alpha: number): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/** The backdrop with the panel's column of light added into it: from black to the light down to its middle, then to grey. */
function drawForceBackdrop(art: ScreenLayer, picture: ImageBitmap, colour: number): void {
  const fit = Math.min(1, MOST / (SCREEN.width * art.kx), MOST / (SCREEN.lines * art.ky));
  const [w, h] = [SCREEN.width * art.kx * fit, SCREEN.lines * art.ky * fit];
  const c = [colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff];
  const painted = art.atlas.picture(`force results picture ${w} ${h} ${colour}`, w, h, (g, left, top) => {
    paintOriginal(g, picture, 0, 0, SCREEN.width, SCREEN.lines, left, top, w, h);
    g.save();
    g.translate(left, top);
    g.scale(w / SCREEN.width, h / SCREEN.lines);
    g.globalCompositeOperation = 'lighter';
    const { x, y } = FORCE_PANEL;
    const upper = g.createLinearGradient(0, y + COLUMN.top, 0, y + COLUMN.full);
    upper.addColorStop(0, 'rgba(0, 0, 0, 1)');
    upper.addColorStop(1, rgba(c, 1));
    g.fillStyle = upper;
    g.fillRect(x + COLUMN.left, y + COLUMN.top, COLUMN.width, COLUMN.full - COLUMN.top);
    const lower = g.createLinearGradient(0, y + COLUMN.full, 0, y + COLUMN.end);
    lower.addColorStop(0, rgba(c, 1));
    lower.addColorStop(1, rgba([COLUMN.grey, COLUMN.grey, COLUMN.grey], 1));
    g.fillStyle = lower;
    g.fillRect(x + COLUMN.left, y + COLUMN.full, COLUMN.width, COLUMN.end - COLUMN.full);
    g.restore();
  });
  if (painted !== null) art.put(painted, 0, 0, SCREEN.width, SCREEN.lines);
}

export function drawForceResults(game: GameState, art: ScreenLayer, text: ScreenLayer, pictures: ForceResultsPictures): void {
  if (game.step === 0) return;
  const force = game.results.force;
  const run = game.world.match.force;
  drawForceBackdrop(art, pictures.backdrop, force.colour);
  const { x, y } = FORCE_PANEL;
  putPortrait(art, pictures.portraits, game.versusPortraits[run.side & 1]!, x, y, force.flipped !== 0);
  for (const [dx, dy, w, h] of FRAME) art.fill(x + dx, y + dy, w, h, [FORCE_FRAME, FORCE_FRAME, FORCE_FRAME, 1]);
  if ((run.flags & FORCE_DR_B) !== 0) {
    for (let k = 0; k < forceBossesShown(game); k += 1) drawIcon(art, pictures.smallIcons, FORCE_BOSSES.x + k * FORCE_BOSSES.step, FORCE_BOSSES.y, run.bosses[k]!);
  }
  for (const printed of game.printed) text.print(printed);
  for (const { level } of game.fades) text.fade(level);
}
