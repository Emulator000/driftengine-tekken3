/**
 * The pause screen, drawn new on the original's design over the held picture: the menu in its
 * box, the chosen word lit; "1P PAUSE" blinking at the pauser's side; each human's command list on
 * its half, its rows on the original's bars (brown to gold; Hwoarang's stance groups green and
 * teal), each move's name set in type and its command below it as icons: the pad's directions as
 * arrows on discs (lit when held), the buttons as a 2 × 2 diagram with the pressed ones lit, the
 * circled numbers, and the text between. Painted once into an atlas at the display's resolution,
 * placed where `pauseView` lays them, over the finished picture.
 */
import type { RendererApi } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { CommandMove, CommandTables, CommandToken } from '../../assets/commands.ts';
import type { FightData, FightState } from '../../sim/fight/state.ts';
import { PaintAtlas, TILES, type AtlasPicture } from '../2d/atlas.ts';
import { screenTint } from '../2d/tint.ts';
import { setType, type TypeStyle } from '../2d/type.ts';
import { DISPLAY } from '../2d/typefaces.ts';
import { printStyle } from './theme.ts';
import { pauseView, type PauseList } from './pause-layout.ts';

type Context = OffscreenCanvasRenderingContext2D;

const LINES = 480;
const ACROSS = 288;
const MIDDLE = 184;
/** The rows' layout within a row, in units: the bar's top and bottom, the name's and the command's baselines. */
const ROW = { height: 0x40, barTop: -2, barBottom: 0x18, name: 0x10, command: 0x34, inset: 6 };
const ICON = 26;
const TYPE = { menu: 11, name: 9, text: 8, title: 8, exit: 8, pause: 15 };
/** Hwoarang's list: its stance groups' rows, and their bars' colours. */
const HWOARANG = 6;
const BARS = { plain: ['#602010', '#b89246'], left: ['#204000', '#5fa255'], right: ['#103040', '#2090a0'] } as const;
const SILVER: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#ffffff'],
    [0.6, '#e4e4e4'],
    [1, '#b8b8b8'],
  ],
  outlines: [[0.16, '#101010']],
  tracking: 0.06,
};
const GOLD: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#fff6c0'],
    [0.5, '#ffcc33'],
    [1, '#d08000'],
  ],
  outlines: [[0.16, '#301000']],
  tracking: 0.06,
};
const LABEL: TypeStyle = { ...SILVER, outlines: [[0.14, '#000000']], tracking: 0.03 };

export class PauseScreen {
  private readonly pass: SpritePass;
  private readonly handle: number;
  private readonly renderer: RendererApi;
  private readonly atlas: PaintAtlas;
  /** The match's data (a new match's replaces it). */
  data: FightData;
  private readonly commands: CommandTables;
  private readonly transform = new Float32Array(6);
  private readonly tint = new Float32Array(4);
  private lines = 0;
  private kx = 1;
  private ky = 1;
  private width = 1;
  /** The lines pictures are cut to, top and bottom, or none. */
  private clipping: readonly [number, number] | null = null;
  private shown = false;

  constructor(renderer: RendererApi, data: FightData, commands: CommandTables) {
    this.renderer = renderer;
    this.data = data;
    this.commands = commands;
    this.pass = createSpritePass({ label: 'pause', capacity: 1024, slots: TILES });
    this.handle = renderer.registerPass(this.pass);
    this.atlas = new PaintAtlas([this.pass]);
  }

  /* ---- Pictures. ---- */

  private type(text: string, style: TypeStyle, cap: number): { picture: AtlasPicture; left: number; baseline: number; ink: number } | null {
    const set = setType(this.atlas.context, text, style, cap * this.ky);
    const picture = this.atlas.picture(`type ${cap} ${style === GOLD ? 'gold' : style === SILVER ? 'silver' : style === LABEL ? 'label' : 'call'} ${text}`, set.width, set.height, (g, left, top) => set.paint(g, left, top));
    return picture && { picture, left: set.left, baseline: set.baseline, ink: (set.width - set.left * 2) / this.kx };
  }

  /** A panel: a dark glass body under a chrome edge, rounded. */
  private panel(key: string, w: number, h: number): AtlasPicture | null {
    const [pw, ph] = [w * this.kx, h * this.ky];
    return this.atlas.picture(`panel ${key} ${w} ${h}`, pw, ph, (g, left, top) => {
      const r = Math.min(pw, ph) * 0.08;
      g.beginPath();
      g.roundRect(left + 1, top + 1, pw - 2, ph - 2, r);
      const body = g.createLinearGradient(0, top, 0, top + ph);
      body.addColorStop(0, 'rgba(48,24,8,0.92)');
      body.addColorStop(1, 'rgba(14,6,2,0.92)');
      g.fillStyle = body;
      g.fill();
      const edge = g.createLinearGradient(0, top, 0, top + ph);
      edge.addColorStop(0, '#f0f0f0');
      edge.addColorStop(0.5, '#8a8a8a');
      edge.addColorStop(1, '#e0e0e0');
      g.strokeStyle = edge;
      g.lineWidth = Math.max(1.5, this.ky * 0.9);
      g.stroke();
    });
  }

  /** A row's bar: a vertical gradient from `top` to `bottom`, its top edge lit. */
  private bar(top: string, bottom: string): AtlasPicture | null {
    const h = (ROW.barBottom - ROW.barTop) * this.ky;
    return this.atlas.picture(`bar ${top} ${bottom}`, 4, h, (g, left, y) => {
      const gradient = g.createLinearGradient(0, y, 0, y + h);
      gradient.addColorStop(0, top);
      gradient.addColorStop(1, bottom);
      g.fillStyle = gradient;
      g.fillRect(left, y, 4, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(left, y, 4, Math.max(1, this.ky * 0.5));
    });
  }

  /** A direction on the pad: an arrow on a disc, the disc lit when the direction is held; neutral a star. */
  private arrow(dir: number, held: boolean): AtlasPicture | null {
    const size = ICON * this.ky;
    return this.atlas.picture(`arrow ${dir} ${held}`, size, size, (g, left, top) => {
      const c = { x: left + size / 2, y: top + size / 2 };
      const r = size * 0.46;
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      const disc = g.createRadialGradient(c.x, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
      disc.addColorStop(0, held ? '#fff2a0' : '#3a3a3a');
      disc.addColorStop(1, held ? '#d08000' : '#101010');
      g.fillStyle = disc;
      g.fill();
      g.strokeStyle = held ? '#fff6d0' : '#c8c8c8';
      g.lineWidth = Math.max(1, size * 0.05);
      g.stroke();
      g.fillStyle = held ? '#301000' : '#ffffff';
      if (dir === 5) {
        g.beginPath();
        for (let i = 0; i < 10; i += 1) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const k = i % 2 === 0 ? r * 0.62 : r * 0.26;
          g.lineTo(c.x + Math.cos(a) * k, c.y + Math.sin(a) * k);
        }
        g.closePath();
        g.fill();
        return;
      }
      /* Numpad: 6 forward (right), 4 back, 8 up, 2 down, and the diagonals between. */
      const dx = [-1, 0, 1, -1, 0, 1, -1, 0, 1][dir - 1]!;
      const dy = [1, 1, 1, 0, 0, 0, -1, -1, -1][dir - 1]!;
      g.save();
      g.translate(c.x, c.y);
      g.rotate(Math.atan2(dy, dx));
      g.beginPath();
      g.moveTo(r * 0.68, 0);
      g.lineTo(r * 0.05, -r * 0.5);
      g.lineTo(r * 0.05, -r * 0.2);
      g.lineTo(-r * 0.62, -r * 0.2);
      g.lineTo(-r * 0.62, r * 0.2);
      g.lineTo(r * 0.05, r * 0.2);
      g.lineTo(r * 0.05, r * 0.5);
      g.closePath();
      g.fill();
      g.restore();
    });
  }

  /** A set of buttons: the pad's four as a 2 × 2 diagram (punches above, kicks below), the pressed ones lit. */
  private buttons(set: readonly number[]): AtlasPicture | null {
    const size = ICON * this.ky;
    return this.atlas.picture(`buttons ${set.join('')}`, size, size, (g, left, top) => {
      g.beginPath();
      g.roundRect(left + size * 0.06, top + size * 0.06, size * 0.88, size * 0.88, size * 0.18);
      g.fillStyle = '#141414';
      g.fill();
      g.strokeStyle = '#a8a8a8';
      g.lineWidth = Math.max(1, size * 0.04);
      g.stroke();
      [1, 2, 3, 4].forEach((button, i) => {
        const x = left + size * (i % 2 === 0 ? 0.32 : 0.68);
        const y = top + size * (i < 2 ? 0.32 : 0.68);
        const lit = set.includes(button);
        g.beginPath();
        g.arc(x, y, size * 0.13, 0, Math.PI * 2);
        g.fillStyle = lit ? '#ffd040' : '#3c3c3c';
        g.fill();
        if (lit) {
          g.strokeStyle = '#fff6d0';
          g.lineWidth = Math.max(1, size * 0.03);
          g.stroke();
        }
      });
    });
  }

  /** A circled number. */
  private badge(n: number): AtlasPicture | null {
    const size = ICON * 0.7 * this.ky;
    return this.atlas.picture(`badge ${n}`, size, size, (g, left, top) => {
      const c = { x: left + size / 2, y: top + size / 2 };
      g.beginPath();
      g.arc(c.x, c.y, size * 0.45, 0, Math.PI * 2);
      g.fillStyle = '#f0f0f0';
      g.fill();
      g.fillStyle = '#101010';
      g.font = `700 ${size * 0.62}px "${DISPLAY.family}", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), c.x, c.y + size * 0.03);
    });
  }

  /* ---- Placing. ---- */

  /** A picture with its top left at a point in units, on whole device pixels. */
  private put(picture: AtlasPicture, x: number, y: number, w = picture.width / this.kx, h = picture.height / this.ky, uv = picture.uv): void {
    const px = Math.round(this.width / 2 + (x - MIDDLE) * this.kx);
    let [top, height, cut] = [Math.round(y * this.ky) / this.ky, h, uv];
    if (this.clipping !== null) {
      const [from, to] = this.clipping;
      const start = Math.max(top, from);
      const end = Math.min(top + h, to);
      if (end <= start) return;
      const v = (line: number): number => uv.v0 + ((line - top) / h) * (uv.v1 - uv.v0);
      cut = { u0: uv.u0, v0: v(start), u1: uv.u1, v1: v(end) };
      [top, height] = [start, end - start];
    }
    drawSprite(this.pass.batch, picture.slot, { x: MIDDLE + (px - this.width / 2) / this.kx, y: top, w, h: height }, cut, null);
  }

  private fill(x: number, y: number, w: number, h: number, colour: readonly [number, number, number, number]): void {
    if (this.clipping !== null) {
      const [from, to] = this.clipping;
      const [start, end] = [Math.max(y, from), Math.min(y + h, to)];
      if (end <= start) return;
      [y, h] = [start, end - start];
    }
    screenTint(this.tint, colour);
    drawSprite(this.pass.batch, this.pass.white, { x, y, w, h }, null, this.tint);
  }

  /** Text with its baseline at `y`, from `x`; returns where it ends. */
  private text(text: string, style: TypeStyle, cap: number, x: number, y: number): number {
    const set = this.type(text, style, cap);
    if (!set) return x;
    this.put(set.picture, x - set.left / this.kx, y - set.baseline / this.ky);
    return x + set.ink;
  }

  /** How far a token reaches across, in units. */
  private reach(t: CommandToken, cap: number): number {
    const icon = (ICON * this.ky) / this.kx;
    if (typeof t === 'string') return this.type(t, LABEL, cap)?.ink ?? 0;
    if ('dir' in t || 'buttons' in t) return icon + 1;
    if ('badge' in t) return icon * 0.7 + 1;
    return 0;
  }

  /** A token from `x` on the baseline `y`; returns where the next one starts. */
  private token(t: CommandToken, x: number, y: number, cap: number): number {
    if (typeof t === 'string') this.text(t, LABEL, cap, x, y);
    else if ('dir' in t || 'buttons' in t) {
      const icon = 'dir' in t ? this.arrow(t.dir, t.held) : this.buttons(t.buttons);
      if (icon) this.put(icon, x, y - ICON * 0.82);
    } else if ('badge' in t) {
      const icon = this.badge(t.badge);
      if (icon) this.put(icon, x, y - ICON * 0.66);
    }
    return x + this.reach(t, cap);
  }

  /** A line of tokens from `x` on the baseline `y`; what follows a gap is set flush to `right`. */
  private tokens(line: readonly CommandToken[], x: number, y: number, right: number, cap: number): void {
    const isGap = (t: CommandToken): boolean => typeof t === 'object' && 'gap' in t;
    const gap = line.findIndex(isGap);
    const before = gap < 0 ? line : line.slice(0, gap);
    const after = gap < 0 ? [] : line.slice(gap).filter((t) => !isGap(t));
    let pen = x;
    for (const t of before) pen = this.token(t, pen, y, cap);
    let at = right - after.reduce((w, t) => w + this.reach(t, cap), 0);
    for (const t of after) at = this.token(t, at, y, cap);
  }

  /** A move's name (its lines) and its command. */
  private move(move: CommandMove, list: PauseList, y: number): void {
    const left = list.left + ROW.inset;
    const right = list.left + list.width - ROW.inset;
    const lines: CommandToken[][] = [[]];
    for (const t of move.name) {
      if (typeof t === 'object' && 'line' in t) lines.push([]);
      else lines[lines.length - 1]!.push(t);
    }
    lines.forEach((line, i) => this.tokens(line, left, y + ROW.name + i * 11, right, TYPE.name));
    this.tokens(move.command, left, y + ROW.command, right, TYPE.text);
  }

  private list(state: FightState, list: PauseList): void {
    const moves = this.commands.lists.get(list.pack) ?? [];
    const roster = state.fighters[list.side]!.roster;
    const [x, w] = [list.left + 1, list.width];
    this.fill(x, list.top - 0x18, w, list.bottom - list.top + 0x18, [0.03, 0.015, 0.005, 0.72]);
    /* The rows cut to the list, so a row easing in shows only within it. */
    this.clipping = [list.top, list.bottom];
    for (const row of list.rows) {
      const group = roster === HWOARANG ? (row.move >= 6 && row.move < 14 ? 'left' : row.move >= 14 ? 'right' : 'plain') : 'plain';
      const header = group !== 'plain' && (row.move === 6 || row.move === 14);
      const [top, bottom] = BARS[group];
      /* A stance group's first row is its header: lit, without the bar's gradient. */
      const bar = this.bar(header ? bottom : top, bottom);
      if (bar) {
        const u = (bar.uv.u0 + bar.uv.u1) / 2;
        this.put(bar, list.left + 3, row.y + ROW.barTop, w - 6, ROW.barBottom - ROW.barTop, { u0: u, v0: bar.uv.v0, u1: u, v1: bar.uv.v1 });
      }
      const move = moves[row.move];
      if (move) this.move(move, list, row.y);
    }
    this.clipping = null;
    /* The title's band above the rows, and the foot below them. */
    this.fill(x, 0x5c, w, list.top - 0x5c, [0.2, 0.06, 0.02, 1]);
    this.fill(x, list.bottom, w, LINES - list.bottom, [0.03, 0.015, 0.005, 1]);
    this.fill(x, list.top - 2, w, 2, [0.88, 0.88, 0.88, 1]);
    this.fill(x, list.bottom, w, 2, [0.88, 0.88, 0.88, 1]);
    const title = this.type('WHEN FACING RIGHT', LABEL, TYPE.title);
    if (title) this.text('WHEN FACING RIGHT', LABEL, TYPE.title, list.left + list.width / 2 - title.ink / 2, 0x6e);
  }

  /** This field's pause screen laid out, for a window `width` by `height` device pixels. */
  prepare(state: FightState, width: number, height: number): void {
    this.width = width;
    if (height !== this.lines) {
      this.lines = height;
      this.kx = height / ACROSS;
      this.ky = height / LINES;
      this.atlas.clear();
    }
    const half = (ACROSS / 2) * (width / height);
    this.transform.set([1 / half, 0, 0, -2 / LINES, -MIDDLE / half, 1]);
    this.pass.setTransform(this.transform);
    this.pass.reset();
    const view = pauseView(state, this.data);
    this.shown = view.menu !== null || view.lists.length > 0;
    if (!this.shown) return;
    if (view.menu) {
      const { box, items } = view.menu;
      const panel = this.panel('menu', box.w + 4, box.h + 6);
      if (panel) this.put(panel, box.x - 2, box.y - 3);
      for (const item of items) {
        if (item.selected) this.fill(box.x + 2, item.y - 1, box.w - 4, 0x12, [0.85, 0.55, 0.1, 0.35]);
        const set = this.type(item.text, item.selected ? GOLD : SILVER, TYPE.menu);
        if (set) this.text(item.text, item.selected ? GOLD : SILVER, TYPE.menu, MIDDLE - set.ink / 2, item.y + 0xd);
      }
    }
    if (view.pause) this.text(`${view.pause.side}P PAUSE`, printStyle(1, 5), TYPE.pause, view.pause.x, view.pause.y + 0x12);
    for (const list of view.lists) this.list(state, list);
    if (view.exit) this.text('PUSH BUTTON TO EXIT', LABEL, TYPE.exit, view.exit.x, view.exit.y + 0xc);
    this.atlas.upload();
  }

  /** The pause screen over the finished picture. */
  draw(): void {
    if (this.shown) this.renderer.drawPass(this.handle);
  }
}
