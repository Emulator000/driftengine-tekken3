/**
 * The fight's HUD, drawn new on the original's design: its bars, end caps, timer, round marks,
 * name plates and the announcer's calls in their places and colours, made as smooth vector shapes
 * and type at the display's resolution. As the original draws them, the back (the bars, names,
 * marks and timer) goes inside the frame behind the fighters, in front of the stage, and the calls
 * over the finished picture. Each picture is painted once into an atlas, one texel to a
 * device pixel, and placed on whole pixels, so nothing is magnified; a display of another height
 * paints them again. The pieces go where `layOutHud` places them, in its order. Tekken Force's keys
 * are painted new as metal keys, and its progress bar is light laid over the finished picture.
 */
import type { RendererApi } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { FightData, FightState } from '../../sim/fight/state.ts';
import { stageCodes } from '../../sim/fight/force-stage.ts';
import { LARGEST, PaintAtlas, TILES, type AtlasPicture } from '../2d/atlas.ts';
import { LightLayer } from '../2d/light.ts';
import { setType } from '../2d/type.ts';
import { INFINITY, layOutHud, progressBar, type BarPart, type PlacedPiece } from './hud-layout.ts';
import { BAR_RAMPS, CHROME, KEY_RAMPS, MARK_RAMPS, PLATE_RAMPS, TIMER_STYLE, printStyle, nameStyle } from './theme.ts';

type Context = OffscreenCanvasRenderingContext2D;

/** The screen's units: 480 lines high, 288 across per unit of aspect, x 192 at the middle. */
const LINES = 480;
const ACROSS = 288;
const MIDDLE = 192;
/** A bar's lines: its frame's top and bottom bands and its fill between, in units down from its top. */
const BAR = { height: 24, frameTop: 1, fillTop: 4, fillBottom: 20, frameBottom: 23 };
/** A cap's width, and its rod's at its outer end, in units across. */
const CAP = { width: 6, rod: 2.4 };
const MARK = { width: 15, height: 18, body: [2, 13], nub: [6, 12], rim: 1.3 };
/** Per printer font, its capitals' height and its baseline under the block's top, in lines. */
const CALL_TYPE = [
  { cap: 11, baseline: 13 },
  { cap: 18, baseline: 21 },
  { cap: 32, baseline: 36 },
] as const;
/** How much wider than the original's block a call may run before it is squeezed. */
const CALL_SLACK = 1.12;
/** A name's capitals and baseline below its line's top; its plate's top and bottom, and how far past the letters it reaches. */
const NAME = { cap: 12, baseline: 14, plateTop: 9, plateBottom: 19, plateReach: 4 };
const DIGIT = { width: 16, cap: 38, baseline: 43 };
/** The calls a fight can print, by font and colour, painted ahead so none is painted mid-fight. */
const CALLS: readonly (readonly [number, number, string])[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [2, 8, `ROUND ${n}`] as const),
  [2, 8, 'FINAL ROUND'],
  [2, 9, 'READY?'],
  [2, 3, 'TIME UP'],
  [2, 2, 'PERFECT!'],
  [2, 1, 'K.O.'],
  [2, 1, 'DOUBLE K.O.'],
  [2, 6, 'DRAW'],
  [2, 4, 'YOU WIN!'],
  [2, 5, 'YOU LOSE'],
  [1, 7, 'REPLAY'],
  [1, 9, 'WINNER'],
  [1, 9, 'LOSER'],
];
/** Tekken Force's calls, by font and colour, painted ahead with its matches; and the digits and marks its runs of digits are laid from. */
const FORCE_CALLS: readonly (readonly [number, number, string])[] = [
  ...[1, 2, 3, 4].map((n) => [2, 8, `STAGE ${n}`] as const),
  [2, 8, 'FINAL STAGE'],
  [2, 8, 'STAGE CLEAR!!'],
  [0, 6, 'NOW LOADING...'],
  [1, 6, 'YOU GOT A KEY!!'],
  [1, 2, 'YOU GOT A KEY!!'],
  [1, 6, 'FINAL STAGE CHALLENGE!!'],
  [1, 2, 'FINAL STAGE CHALLENGE!!'],
  [0, 2, ' +LIFE!'],
  [0, 5, ' +LIFE!'],
  [0, 5, '+'],
  [0, 6, 'SEC'],
  [0, 5, 'SCORE '],
  [0, 2, 'HI-SCORE '],
];
const FORCE_DIGITS: readonly (readonly [number, number])[] = [
  [0, 5],
  [0, 6],
  [1, 5],
];
const TEKKEN_FORCE = 8;
/** The printer's fonts' cells, as the layout gives each call its block: a glyph's advance and its width. */
const PRINTER = [
  { advance: 9, width: 10 },
  { advance: 13, width: 14 },
  { advance: 22, width: 24 },
] as const;
/** The soldiers' roster, whose names keep the first costume's colours. */
const SOLDIERS = 0x15;

/**
 * Arcade's run time under the bars, minutes, seconds and hundredths in two digits each (the small
 * font, colour 5, a two-glyph block): its hundredths change every field, so every value is painted
 * ahead, where each new one was painted and the atlas uploaded on the field it first showed.
 */
const CLOCK = { font: 0, colour: 5, block: 19 } as const;
/** The display's lines up to which what a fight shows, painted ahead, fits an atlas 2048 a side; the atlas is sized from the lines past them. */
const FITS_2048 = 1100;

/** A vertical gradient over `top` to `bottom` through evenly spaced colours. */
function ramp(g: Context, top: number, bottom: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gradient = g.createLinearGradient(0, top, 0, bottom);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  return gradient;
}

/** Light at the middle, darkening to both edges: a cylinder's shading over a ramp light to dark. */
const cylinder = (r: readonly string[]): (readonly [number, string])[] => [
  [0, r[5]!],
  [0.14, r[4]!],
  [0.28, r[2]!],
  [0.4, r[0]!],
  [0.5, r[1]!],
  [0.66, r[2]!],
  [0.82, r[3]!],
  [1, r[5]!],
];

/** A piece's tint for its brightness (none for the usual). */
const glowTint = (glow: number | undefined): number[] | null => (glow === undefined ? null : [glow, glow, glow, 1]);

export class Hud {
  private readonly back: SpritePass;
  private readonly front: SpritePass;
  private readonly backHandle: number;
  private readonly frontHandle: number;
  private readonly renderer: RendererApi;
  private readonly atlas: PaintAtlas;
  private names: readonly string[];
  private data: FightData;
  /** Tekken Force's: its name rows' names as its stage may show them (side, name, costume), and its progress bar's light (made for its first match). */
  private forceNames: readonly (readonly [0 | 1, string, number])[] = [];
  private light: LightLayer | null = null;
  private lit = false;
  /** A called line's words as the players read them (the buttons named for their controllers). */
  words: (text: string) => string = (text) => text;
  private readonly transform = new Float32Array(6);
  /** The display's height the atlas is painted for, and its pixels per unit across and down. */
  private lines = 0;
  private kx = 1;
  private ky = 1;
  private width = 1;

  constructor(renderer: RendererApi, data: FightData, state: FightState) {
    this.renderer = renderer;
    this.back = createSpritePass({ label: 'hud back', capacity: 256, slots: TILES });
    this.front = createSpritePass({ label: 'hud calls', capacity: 256, slots: TILES });
    this.backHandle = renderer.registerPass(this.back);
    this.frontHandle = renderer.registerPass(this.front);
    this.atlas = new PaintAtlas([this.back, this.front]);
    this.data = data;
    this.names = state.fighters.slice(0, 2).map((f) => data.roster.codes[f.rosterCode]?.name ?? '');
    this.forceNames = this.forceNamesOf(data, state);
  }

  /** A new match: its fighters' names. */
  newMatch(data: FightData, state: FightState): void {
    this.data = data;
    this.names = state.fighters.slice(0, 2).map((f) => data.roster.codes[f.rosterCode]?.name ?? '');
    const forceNames = this.forceNamesOf(data, state);
    /* A Tekken Force stage's enemies' names painted with it, not when each first comes in. */
    if (this.lines !== 0) for (const [side, text, costume] of forceNames) this.nameplate(side, text, costume);
    this.forceNames = forceNames;
  }

  /** In Tekken Force, the player's name and the names its stage may bring on (soldiers, boss), as their rows show them. */
  private forceNamesOf(data: FightData, state: FightState): (readonly [0 | 1, string, number])[] {
    if (state.mode !== TEKKEN_FORCE) return [];
    const player = state.fighters[0]!.rosterCode;
    const name = (side: 0 | 1, code: number): readonly [0 | 1, string, number] => [side, data.roster.codes[code]?.name ?? '', code >> 2 === SOLDIERS ? 0 : code & 3];
    return [name(0, player), ...stageCodes(data, player, state.force.stage).map((code) => name(1, code))];
  }

  /* ---- The pictures, each painted in device pixels. ---- */

  private barColumn(part: BarPart): AtlasPicture | null {
    const ky = this.ky;
    return this.atlas.picture(`bar ${part}`, 4, BAR.height * ky, (g, left, top) => {
      const y = (u: number): number => top + u * ky;
      const r = BAR_RAMPS[part];
      g.fillStyle = ramp(g, y(BAR.frameTop), y(BAR.fillTop), [
        [0, CHROME[1]!],
        [0.35, CHROME[2]!],
        [1, CHROME[5]!],
      ]);
      g.fillRect(left, y(BAR.frameTop), 4, (BAR.fillTop - BAR.frameTop) * ky);
      g.fillStyle = ramp(g, y(BAR.fillBottom), y(BAR.frameBottom), [
        [0, CHROME[5]!],
        [0.65, CHROME[3]!],
        [1, CHROME[1]!],
      ]);
      g.fillRect(left, y(BAR.fillBottom), 4, (BAR.frameBottom - BAR.fillBottom) * ky);
      g.fillStyle = ramp(g, y(BAR.fillTop), y(BAR.fillBottom), [
        [0, r[5]!],
        [0.1, r[3]!],
        [0.24, r[1]!],
        [0.32, r[0]!],
        [0.46, r[0]!],
        [0.56, r[2]!],
        [0.74, r[3]!],
        [0.9, r[4]!],
        [1, r[5]!],
      ]);
      g.fillRect(left, y(BAR.fillTop), 4, (BAR.fillBottom - BAR.fillTop) * ky);
      /* A sheen across the fill's upper part. */
      g.fillStyle = ramp(g, y(BAR.fillTop), y(BAR.fillTop + 7), [
        [0, 'rgba(255, 255, 255, 0)'],
        [0.35, 'rgba(255, 255, 255, 0.32)'],
        [1, 'rgba(255, 255, 255, 0)'],
      ]);
      g.fillRect(left, y(BAR.fillTop), 4, 7 * ky);
    });
  }

  private cap(end: 0 | 1): AtlasPicture | null {
    const { kx, ky } = this;
    const width = CAP.width * kx;
    return this.atlas.picture(`cap ${end}`, width, BAR.height * ky, (g, left, top) => {
      const rod = CAP.rod * kx;
      const rodLeft = end === 0 ? left : left + width - rod;
      /* The rod: a polished cylinder standing the bar's height, lit along its middle. */
      const across = g.createLinearGradient(rodLeft, 0, rodLeft + rod, 0);
      [CHROME[4]!, CHROME[1]!, CHROME[0]!, CHROME[2]!, CHROME[5]!].forEach((c, i) => across.addColorStop(i / 4, c));
      g.fillStyle = across;
      g.beginPath();
      g.roundRect(rodLeft, top + 0.2 * ky, rod, (BAR.height - 0.4) * ky, rod / 2);
      g.fill();
      g.fillStyle = ramp(g, top, top + BAR.height * ky, [
        [0, 'rgba(0, 0, 0, 0.35)'],
        [0.2, 'rgba(0, 0, 0, 0)'],
        [0.8, 'rgba(0, 0, 0, 0)'],
        [1, 'rgba(0, 0, 0, 0.45)'],
      ]);
      g.fill();
    });
  }

  /** A Team Battle member's mark: an upright pill, gold while standing, dark once beaten, a red cross over it when crossed out. */
  private teamMark(crossed: boolean, beaten: boolean, w: number, h: number): AtlasPicture | null {
    const { kx, ky } = this;
    return this.atlas.picture(`team mark ${crossed} ${beaten}`, w * kx, h * ky, (g, left, top) => {
      const [pw, ph] = [w * kx, h * ky];
      const body = g.createLinearGradient(left, 0, left + pw, 0);
      const stops = beaten ? ['#3a1a1a', '#6a3030', '#2a1010'] : ['#8a6010', '#ffe080', '#a07010'];
      stops.forEach((colour, k) => body.addColorStop(k / (stops.length - 1), colour));
      g.fillStyle = body;
      g.beginPath();
      g.roundRect(left + kx, top + ky, pw - 2 * kx, ph - 2 * ky, Math.min(pw, ph) / 3);
      g.fill();
      g.strokeStyle = '#101010';
      g.lineWidth = Math.max(1, kx * 0.6);
      g.stroke();
      if (!crossed) return;
      g.strokeStyle = '#ff2020';
      g.lineWidth = Math.max(1.5, kx * 1.6);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(left + kx, top + ph * 0.3);
      g.lineTo(left + pw - kx, top + ph * 0.7);
      g.moveTo(left + pw - kx, top + ph * 0.3);
      g.lineTo(left + kx, top + ph * 0.7);
      g.stroke();
    });
  }

  private mark(lit: boolean): AtlasPicture | null {
    const { kx, ky } = this;
    return this.atlas.picture(`mark ${lit}`, MARK.width * kx, MARK.height * ky, (g, left, top) => {
      const x = (u: number): number => left + u * kx;
      const y = (u: number): number => top + u * ky;
      const r = lit ? MARK_RAMPS.lit : MARK_RAMPS.empty;
      /* The nubs joining the marks in a row. */
      g.fillStyle = ramp(g, y(MARK.nub[0]!), y(MARK.nub[1]!), cylinder(CHROME));
      g.fillRect(x(0), y(MARK.nub[0]!), MARK.width * kx, (MARK.nub[1]! - MARK.nub[0]!) * ky);
      /* The body: a cylinder lying across, gold when lit, glowing. */
      const [from, to] = MARK.body as [number, number];
      g.save();
      if (lit) {
        g.shadowColor = 'rgba(255, 200, 40, 0.75)';
        g.shadowBlur = 3 * ky;
      }
      g.fillStyle = ramp(g, y(0), y(MARK.height), cylinder(r));
      g.beginPath();
      g.roundRect(x(from), y(0.3), (to - from) * kx, (MARK.height - 0.6) * ky, 1.6 * ky);
      g.fill();
      g.restore();
      /* Its chrome rims. */
      g.fillStyle = ramp(g, y(0), y(MARK.height), cylinder(CHROME));
      for (const at of [from, to - MARK.rim]) {
        g.beginPath();
        g.roundRect(x(at), y(0.3), MARK.rim * kx, (MARK.height - 0.6) * ky, (MARK.rim * kx) / 2);
        g.fill();
      }
    });
  }

  /** A Tekken Force key (0 copper, 1 silver, 2 gold): a polished key leaning right, its ring at the foot, its bit at the head. */
  private key(index: number, w: number, h: number): AtlasPicture | null {
    const { kx, ky } = this;
    return this.atlas.picture(`key ${index}`, w * kx, h * ky, (g, left, top) => {
      const [pw, ph] = [w * kx, h * ky];
      const r = KEY_RAMPS[index] ?? KEY_RAMPS[0]!;
      const size = Math.min(pw, ph * 0.62);
      const shaft = size * 0.17;
      const ring = size * 0.24;
      g.save();
      g.translate(left + pw * 0.34, top + ph * 0.8);
      g.rotate(0.5);
      const metal = g.createLinearGradient(-shaft * 2, 0, shaft * 2, 0);
      [r[3]!, r[1]!, r[0]!, r[2]!, r[4]!].forEach((c, i) => metal.addColorStop(i / 4, c));
      g.fillStyle = metal;
      g.strokeStyle = r[4]!;
      g.lineWidth = Math.max(1, 0.06 * size);
      /* The ring, its hole through it. */
      g.beginPath();
      g.arc(0, 0, ring, 0, Math.PI * 2);
      g.arc(0, 0, ring * 0.48, 0, Math.PI * 2, true);
      g.fill('evenodd');
      g.stroke();
      /* The shaft up from the ring, and the bit's teeth along its head. */
      const length = ph * 0.86;
      g.beginPath();
      g.rect(-shaft / 2, -length, shaft, length - ring * 0.9);
      g.rect(-shaft / 2 - shaft * 1.1, -length, shaft * 1.1, shaft * 0.9);
      g.rect(-shaft / 2 - shaft * 0.8, -length + shaft * 1.5, shaft * 0.8, shaft * 0.8);
      g.fill();
      g.stroke();
      g.restore();
    });
  }

  /** The marker over the progress bar's cursor: a triangle pointing down, white for the light layer to colour. */
  private marker(): { slot: number; uv: AtlasPicture['uv'] } | null {
    const light = this.light;
    if (light === null) return null;
    return light.atlas.picture('marker', 32, 16, (g, left, top) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(left, top);
      g.lineTo(left + 32, top);
      g.lineTo(left + 16, top + 16);
      g.closePath();
      g.fill();
    });
  }

  /** Text in a style at a cap height (in lines), as a picture with its ink's left and its baseline. */
  private type(key: string, text: string, style: Parameters<typeof setType>[2], cap: number, maxWidth = Infinity): { picture: AtlasPicture; left: number; baseline: number } | null {
    const set = setType(this.atlas.context, text, style, cap * this.ky, maxWidth);
    const picture = this.atlas.picture(key, set.width, set.height, (g, left, top) => set.paint(g, left, top));
    return picture && { picture, left: set.left, baseline: set.baseline };
  }

  private digit(text: string): ReturnType<Hud['type']> {
    return this.type(`timer ${text}`, text, TIMER_STYLE, DIGIT.cap);
  }

  private call(font: number, colour: number, text: string, block: number): ReturnType<Hud['type']> {
    const type = CALL_TYPE[font] ?? CALL_TYPE[2];
    return this.type(`call ${font} ${colour} ${text}`, text, printStyle(font, colour), type.cap, block * this.kx * CALL_SLACK);
  }

  /** A name on its plate: the plate's slanted bar in the costume's colours under the name's lower part. */
  private nameplate(side: 0 | 1, text: string, costume: number): { picture: AtlasPicture; left: number; baseline: number } | null {
    const { kx, ky } = this;
    const set = setType(this.atlas.context, text, nameStyle(costume), NAME.cap * ky);
    const ink = set.width - set.left * 2;
    const reach = NAME.plateReach * kx;
    const slant = (NAME.plateBottom - NAME.plateTop) * ky * 0.6;
    const pad = Math.ceil(slant + reach);
    const plateTop = set.baseline - (NAME.baseline - NAME.plateTop) * ky;
    const plateBottom = set.baseline + (NAME.plateBottom - NAME.baseline) * ky;
    const width = ink + pad * 2;
    const height = Math.max(set.height, plateBottom + ky);
    const picture = this.atlas.picture(`name ${side} ${costume} ${text}`, width, height, (g, left, top) => {
      const r = PLATE_RAMPS[costume] ?? PLATE_RAMPS[0]!;
      const l = left + pad - reach;
      const rr = left + pad + ink + reach;
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.45)';
      g.shadowBlur = ky;
      g.shadowOffsetY = 0.5 * ky;
      g.fillStyle = ramp(g, top + plateTop, top + plateBottom, [
        [0, r[5]!],
        [0.15, r[3]!],
        [0.35, r[0]!],
        [0.5, r[1]!],
        [0.75, r[3]!],
        [1, r[6]!],
      ]);
      g.beginPath();
      /* The outer end square, the inner one slanted toward the middle. */
      if (side === 0) {
        g.moveTo(l, top + plateTop);
        g.lineTo(rr + slant, top + plateTop);
        g.lineTo(rr, top + plateBottom);
        g.lineTo(l, top + plateBottom);
      } else {
        g.moveTo(l - slant, top + plateTop);
        g.lineTo(rr, top + plateTop);
        g.lineTo(rr, top + plateBottom);
        g.lineTo(l, top + plateBottom);
      }
      g.closePath();
      g.fill();
      g.restore();
      /* A lit edge along the plate's top. */
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.fillRect(l, top + plateTop, rr - l, Math.max(1, 0.6 * ky));
      set.paint(g, left + pad - set.left, top);
    });
    return picture && { picture, left: pad, baseline: set.baseline };
  }

  /** Everything a fight shows painted, at the display's scale. */
  private paintAhead(): void {
    for (const part of ['health', 'damage', 'lost', 'empty'] as const) this.barColumn(part);
    this.cap(0);
    this.cap(1);
    this.mark(true);
    this.mark(false);
    for (let d = 0; d < 10; d += 1) this.digit(String(d));
    this.names.forEach((name, side) => this.nameplate(side as 0 | 1, name, 0));
    for (const [font, colour, text] of [...CALLS, ...this.names.map((name) => [2, 4, `${name} WINS!`] as const)]) this.call(font, colour, text, (text.length - 1) * 22 + 24);
    for (let n = 0; n < 100; n += 1) this.call(CLOCK.font, CLOCK.colour, String(n).padStart(2, '0'), CLOCK.block);
    if (this.forceNames.length === 0) return;
    for (const [side, text, costume] of this.forceNames) this.nameplate(side, text, costume);
    for (const [font, colour, text] of FORCE_CALLS) this.call(font, colour, text, (text.length - 1) * PRINTER[font]!.advance + PRINTER[font]!.width);
    for (const [font, colour] of FORCE_DIGITS) for (const glyph of '0123456789"\'') this.call(font, colour, glyph, PRINTER[font]!.width);
    for (let k = 0; k < 3; k += 1) this.key(k, 20, 36);
  }

  /* ---- Drawing. ---- */

  /** A picture with its top left at a point in units, moved to whole device pixels, one texel a pixel. */
  private put(pass: SpritePass, picture: AtlasPicture, x: number, y: number, uv = picture.uv, tint: readonly number[] | null = null): void {
    const px = Math.round(this.width / 2 + (x - MIDDLE) * this.kx);
    const py = Math.round(y * this.ky);
    drawSprite(pass.batch, picture.slot, { x: MIDDLE + (px - this.width / 2) / this.kx, y: py / this.ky, w: picture.width / this.kx, h: picture.height / this.ky }, uv, tint);
  }

  private drawPiece(pass: SpritePass, placed: PlacedPiece): void {
    const { piece } = placed;
    switch (piece.kind) {
      case 'bar': {
        const column = this.barColumn(piece.part);
        if (!column) return;
        const u = (column.uv.u0 + column.uv.u1) / 2;
        drawSprite(pass.batch, column.slot, { x: placed.x, y: placed.y, w: placed.w, h: placed.h }, { u0: u, v0: column.uv.v0, u1: u, v1: column.uv.v1 }, glowTint(piece.glow));
        return;
      }
      case 'cap': {
        const cap = this.cap(piece.end);
        if (cap) this.put(pass, cap, placed.x, placed.y, cap.uv, glowTint(piece.glow));
        return;
      }
      case 'mark': {
        const mark = this.mark(piece.lit);
        if (mark) this.put(pass, mark, placed.x, placed.y);
        return;
      }
      case 'key': {
        const key = this.key(piece.index, placed.w, placed.h);
        if (key) this.put(pass, key, placed.x, placed.y);
        return;
      }
      case 'team': {
        const mark = this.teamMark(piece.crossed, piece.beaten, placed.w, placed.h);
        if (mark) this.put(pass, mark, placed.x, placed.y);
        return;
      }
      case 'timer': {
        const cells = piece.text === INFINITY ? [[piece.text, placed.x, placed.w]] : [...piece.text].map((d, i) => [d, placed.x + i * (placed.w - DIGIT.width), DIGIT.width]);
        for (const [text, x, w] of cells as [string, number, number][]) {
          const set = this.digit(text);
          if (!set) continue;
          const ink = set.picture.width - set.left * 2;
          this.put(pass, set.picture, x + w / 2 - (set.left + ink / 2) / this.kx, placed.y + DIGIT.baseline - set.baseline / this.ky);
        }
        return;
      }
      case 'name': {
        const plate = this.nameplate(piece.side, piece.text, piece.costume);
        if (!plate) return;
        const ink = plate.picture.width - plate.left * 2;
        const start = piece.side === 0 ? placed.x : placed.x - ink / this.kx;
        this.put(pass, plate.picture, start - plate.left / this.kx, placed.y + NAME.baseline - plate.baseline / this.ky);
        return;
      }
      case 'call': {
        const set = this.call(piece.font, piece.colour, this.words(piece.text), placed.w);
        if (!set) return;
        const type = CALL_TYPE[piece.font] ?? CALL_TYPE[2];
        this.put(pass, set.picture, placed.x + placed.w / 2 - set.picture.width / 2 / this.kx, placed.y + type.baseline - set.baseline / this.ky);
        return;
      }
    }
  }

  /** This field's HUD laid into its two passes, for a window `width` by `height` device pixels. */
  prepare(state: FightState, width: number, height: number): void {
    this.width = width;
    if (height !== this.lines) {
      this.lines = height;
      this.kx = height / ACROSS;
      this.ky = height / LINES;
      this.atlas.resize(Math.min(LARGEST, Math.max(2048, Math.ceil((2048 * height) / FITS_2048 / 256) * 256)));
      this.paintAhead();
    }
    const half = (ACROSS / 2) * (width / height);
    this.transform.set([1 / half, 0, 0, -2 / LINES, -MIDDLE / half, 1]);
    const { back, front } = layOutHud(state, this.names, this.data);
    for (const [pass, pieces] of [
      [this.back, back],
      [this.front, front],
    ] as const) {
      pass.setTransform(this.transform);
      pass.reset();
      for (const placed of pieces) this.drawPiece(pass, placed);
    }
    this.atlas.upload();
    this.lit = state.mode === TEKKEN_FORCE;
    if (this.lit) this.layProgress(state, width, height);
  }

  /** Tekken Force's progress bar laid as light over the finished picture. */
  private layProgress(state: FightState, width: number, height: number): void {
    this.light ??= new LightLayer(this.renderer, 'hud light', { middle: MIDDLE, across: ACROSS });
    const light = this.light;
    light.begin(width, height);
    for (const q of progressBar(state, this.data)) {
      if (!q.triangle) {
        light.quad(q.blend, q.x, q.y, q.w, q.h, q.top, q.bottom, null, false, q.alpha);
        continue;
      }
      const marker = this.marker();
      if (marker !== null) light.quad(q.blend, q.x, q.y, q.w, q.h, q.top, q.bottom, marker, true, q.alpha);
    }
  }

  /** The bars, names, marks and timer, inside the frame: after the stage, before the fighters. */
  drawBack(): void {
    this.renderer.drawPass(this.backHandle);
  }

  /** The calls, over the finished picture (Tekken Force's progress bar over them). */
  drawFront(): void {
    this.renderer.drawPass(this.frontHandle);
    if (this.lit) this.light?.end();
  }
}
