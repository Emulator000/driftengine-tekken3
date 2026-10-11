/**
 * The wall climbing behind the character select's portraits, drawn new tile by tile on the
 * original's exact lines (each tile 48 pixels across and 64 lines down): riveted steel panels, a
 * perforated mesh behind X braces, a pipe running along the wall from its bend, panels marked with
 * a triangle, a vent fed by conduit from a control box, and a grid of I-beam columns (one carrying a
 * clamped pipe across) with open space between. The colours are the original's per tile, from its
 * palettes; the open spaces are left clear for the black behind.
 */
type Context = OffscreenCanvasRenderingContext2D;

export const TILE = { w: 48, h: 64 } as const;
export const Tile = { PANELS: 0, MESH: 1, VENT_START: 2, VENT: 3, BEND: 4, PIPE: 5, CLAMPED: 6, COLUMNS: 7, TRIANGLE: 8 } as const;

/** The panels' palette (dark to light), and the mesh's and columns' violet one. */
const STEEL = ['#100808', '#161210', '#28241e', '#393131', '#4a3939', '#554d4a'] as const;
const VIOLET = ['#0c0609', '#1f121a', '#2a2327', '#392c34', '#4a3a44', '#5a4a54'] as const;

/** A tile's space: x in its pixels, y in its lines, to device pixels. */
interface Space {
  readonly X: (u: number) => number;
  readonly Y: (v: number) => number;
  readonly kx: number;
  readonly ky: number;
}

function rect(g: Context, s: Space, u0: number, v0: number, u1: number, v1: number, colour: string): void {
  g.fillStyle = colour;
  g.fillRect(s.X(u0), s.Y(v0), s.X(u1) - s.X(u0), s.Y(v1) - s.Y(v0));
}

/** A rivet's head at (u, v): a dome lit from above, its shadow below and right. */
function rivet(g: Context, s: Space, u: number, v: number, palette: readonly string[]): void {
  const [cx, cy] = [s.X(u + 0.5), s.Y(v + 1.2)];
  const [rx, ry] = [0.9 * s.kx, 1.3 * s.ky];
  g.fillStyle = palette[0]!;
  g.beginPath();
  g.ellipse(cx + rx * 0.35, cy + ry * 0.45, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  const dome = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.35, 0, cx, cy, Math.max(rx, ry));
  dome.addColorStop(0, palette[4]!);
  dome.addColorStop(0.6, palette[3]!);
  dome.addColorStop(1, palette[1]!);
  g.fillStyle = dome;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** A row of rivets six pixels apart from x 2, their tops on line `v`. */
function rivets(g: Context, s: Space, v: number, palette: readonly string[]): void {
  for (let u = 2; u < TILE.w; u += 6) rivet(g, s, u, v, palette);
}

/**
 * One panel 32 lines tall from line `v`: its seam line on top, a rivet row, its upper face dark and
 * its lower face lighter (shading in over four lines), a second rivet row, an edge line; `seam`
 * splits it at x 23 with rivets either side.
 */
function panel(g: Context, s: Space, v: number, seam: boolean): void {
  rect(g, s, 0, v, TILE.w, v + 32, STEEL[1]!);
  const face = g.createLinearGradient(0, s.Y(v + 14), 0, s.Y(v + 19));
  face.addColorStop(0, STEEL[1]!);
  face.addColorStop(1, STEEL[2]!);
  g.fillStyle = face;
  g.fillRect(s.X(0), s.Y(v + 14), s.X(TILE.w) - s.X(0), s.Y(v + 31) - s.Y(v + 14));
  rect(g, s, 0, v, TILE.w, v + 1, STEEL[0]!);
  rect(g, s, 0, v, 0.8, v + 32, STEEL[0]!);
  rect(g, s, TILE.w - 0.8, v, TILE.w, v + 32, STEEL[0]!);
  rivets(g, s, v + 1.2, STEEL);
  rivets(g, s, v + 26, STEEL);
  rivet(g, s, 1.5, v + 9.5, STEEL);
  rivet(g, s, TILE.w - 2.5, v + 9.5, STEEL);
  if (seam) {
    rect(g, s, 23, v, 25, v + 32, STEEL[0]!);
    rect(g, s, 25, v, 25.6, v + 32, STEEL[2]!);
    rivet(g, s, 21, v + 9.5, STEEL);
    rivet(g, s, 26, v + 9.5, STEEL);
  }
}

/** The plain wall: two panels, the lower split by a seam. */
function panels(g: Context, s: Space): void {
  panel(g, s, 0, false);
  panel(g, s, 32, true);
}

/** A pipe along a path, `thickness` lines through: a cylinder lit along its middle, in layered strokes. */
function pipe(g: Context, s: Space, points: readonly (readonly [number, number])[], thickness: number, cap: CanvasLineCap): void {
  const path = new Path2D();
  points.forEach(([u, v], i) => (i === 0 ? path.moveTo(s.X(u), s.Y(v)) : path.lineTo(s.X(u), s.Y(v))));
  g.lineCap = cap;
  g.lineJoin = 'round';
  const shades = [STEEL[1], STEEL[2], STEEL[3], STEEL[4], STEEL[5]] as const;
  shades.forEach((colour, i) => {
    g.strokeStyle = colour!;
    g.lineWidth = thickness * s.ky * (1 - i * 0.19);
    g.stroke(path);
  });
}

/** The pipe's shadow on the wall under it. */
function pipeShadow(g: Context, s: Space, points: readonly (readonly [number, number])[], thickness: number): void {
  const path = new Path2D();
  points.forEach(([u, v], i) => (i === 0 ? path.moveTo(s.X(u), s.Y(v + 7)) : path.lineTo(s.X(u), s.Y(v + 7))));
  g.lineCap = 'round';
  g.strokeStyle = STEEL[0]!;
  g.lineWidth = thickness * s.ky;
  g.stroke(path);
}

/** The pipe straight across lines 21 to 40, a joint ring at x 35, its shadow below. */
function straightPipe(g: Context, s: Space): void {
  panels(g, s);
  pipeShadow(g, s, [[-2, 30.5], [TILE.w + 2, 30.5]], 20);
  pipe(g, s, [[-2, 30.5], [TILE.w + 2, 30.5]], 20, 'butt');
  const ring = g.createLinearGradient(s.X(35), 0, s.X(39), 0);
  ring.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  ring.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
  ring.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
  g.fillStyle = ring;
  g.fillRect(s.X(35), s.Y(21), s.X(39) - s.X(35), s.Y(41) - s.Y(21));
  rect(g, s, 35, 45, 38.5, 48, STEEL[2]!);
}

/** The pipe's bend: from the wall below-left, rising to run along lines 21 to 40. */
function bend(g: Context, s: Space): void {
  panels(g, s);
  const course = [
    [6, 52],
    [16, 40],
    [26, 31],
    [34, 30.5],
    [TILE.w + 2, 30.5],
  ] as const;
  pipeShadow(g, s, course, 20);
  pipe(g, s, course, 20, 'round');
}

/** The panels marked with a pale triangle pointing down, from line 15 to its point at line 48. */
function triangle(g: Context, s: Space): void {
  panels(g, s);
  const shape = new Path2D();
  shape.moveTo(s.X(4), s.Y(15));
  shape.lineTo(s.X(44), s.Y(15));
  shape.lineTo(s.X(25.5), s.Y(48));
  shape.closePath();
  const fill = g.createLinearGradient(0, s.Y(15), 0, s.Y(48));
  fill.addColorStop(0, 'rgba(120, 104, 98, 0.62)');
  fill.addColorStop(1, 'rgba(96, 82, 78, 0.5)');
  g.fillStyle = fill;
  g.fill(shape);
}

/** A thin conduit pipe: a lit line over a shadow line. */
function conduit(g: Context, s: Space, u0: number, v: number, u1: number): void {
  rect(g, s, u0, v, u1, v + 1, STEEL[4]!);
  rect(g, s, u0, v + 1, u1, v + 2, STEEL[2]!);
  rect(g, s, u0, v + 2, u1, v + 2.6, STEEL[0]!);
}

/** The vent's slats every four lines from line 40, from x `u0`. */
function slats(g: Context, s: Space, u0: number): void {
  for (let v = 40; v <= 56; v += 4) {
    rect(g, s, u0, v, TILE.w, v + 1, STEEL[4]!);
    rect(g, s, u0, v + 1, TILE.w, v + 2, STEEL[2]!);
    rect(g, s, u0, v + 2, TILE.w, v + 3, STEEL[0]!);
  }
}

/** The vent's run: conduits along lines 8, 11 and 22, its slats, a seam at x 41. */
function vent(g: Context, s: Space): void {
  panels(g, s);
  conduit(g, s, 0, 8, TILE.w);
  conduit(g, s, 0, 11, TILE.w);
  conduit(g, s, 0, 22, TILE.w);
  slats(g, s, 0);
  rect(g, s, 41, 0, 43, TILE.h, STEEL[0]!);
  rect(g, s, 43, 0, 43.6, TILE.h, STEEL[2]!);
}

/** The vent's start: the conduits turning down at x 9 to a control box, the slats from x 20. */
function ventStart(g: Context, s: Space): void {
  panels(g, s);
  conduit(g, s, 11, 8, TILE.w);
  conduit(g, s, 14, 11, TILE.w);
  conduit(g, s, 15, 22, TILE.w);
  rect(g, s, 9, 9, 10, 37, STEEL[4]!);
  rect(g, s, 10, 9, 11, 37, STEEL[2]!);
  rect(g, s, 12, 12, 13, 37, STEEL[4]!);
  rect(g, s, 13, 12, 14, 37, STEEL[2]!);
  /* The box, its screen. */
  rect(g, s, 5, 37, 19, 58, STEEL[0]!);
  rect(g, s, 6, 38, 18, 57, STEEL[3]!);
  rect(g, s, 6.6, 38.6, 17.4, 39.6, STEEL[5]!);
  rect(g, s, 8, 41, 16, 44, STEEL[0]!);
  rect(g, s, 8, 44, 16, 44.6, STEEL[4]!);
  slats(g, s, 20);
  rect(g, s, 19, 37, 20, 59, STEEL[0]!);
}

/** The violet rails across a column tile's top and foot. */
function rails(g: Context, s: Space): void {
  for (const [v, colour] of [
    [0, VIOLET[3]],
    [1, VIOLET[0]],
    [3, VIOLET[2]],
    [4, VIOLET[0]],
    [59, VIOLET[0]],
    [60, VIOLET[3]],
    [61, VIOLET[0]],
    [63, VIOLET[2]],
  ] as const) rect(g, s, 0, v, TILE.w, v + 1, colour!);
}

/** An I-beam column at x 20 to 28, its capital and base flared, lit on its right. */
function column(g: Context, s: Space): void {
  rect(g, s, 18, 5, 30, 7, VIOLET[2]!);
  rect(g, s, 19, 57, 29, 59, VIOLET[2]!);
  const shaft = g.createLinearGradient(s.X(20), 0, s.X(28), 0);
  shaft.addColorStop(0, VIOLET[2]!);
  shaft.addColorStop(0.2, VIOLET[1]!);
  shaft.addColorStop(0.7, VIOLET[1]!);
  shaft.addColorStop(0.9, VIOLET[3]!);
  shaft.addColorStop(1, VIOLET[2]!);
  g.fillStyle = shaft;
  g.fillRect(s.X(20), s.Y(7), s.X(28) - s.X(20), s.Y(57) - s.Y(7));
}

/** The grid's columns: rails and a column, open between. */
function columns(g: Context, s: Space): void {
  rails(g, s);
  column(g, s);
}

/** The grid's clamped pipe: the columns, a pipe across lines 29 to 35, clamps at x 12 and 33, a bar under it. */
function clamped(g: Context, s: Space): void {
  columns(g, s);
  rect(g, s, 0, 5, 12, 6.4, VIOLET[1]!);
  rect(g, s, 35, 5, TILE.w, 6.4, VIOLET[1]!);
  for (const u of [12, 33]) {
    rect(g, s, u, 7, u + 1.4, 41, VIOLET[1]!);
    rect(g, s, u - 2, 27, u + 3.4, 29, VIOLET[2]!);
    rect(g, s, u - 2, 36, u + 3.4, 38, VIOLET[2]!);
  }
  const across = g.createLinearGradient(0, s.Y(29), 0, s.Y(36));
  across.addColorStop(0, VIOLET[0]!);
  across.addColorStop(0.2, VIOLET[3]!);
  across.addColorStop(0.6, VIOLET[2]!);
  across.addColorStop(1, VIOLET[0]!);
  g.fillStyle = across;
  g.fillRect(s.X(0), s.Y(29), s.X(TILE.w) - s.X(0), s.Y(36) - s.Y(29));
  rect(g, s, 13, 40, 35, 42, VIOLET[2]!);
}

/** The perforated mesh behind X braces in a frame of posts and rails. */
function mesh(g: Context, s: Space): void {
  /* The plate, then its holes punched: plus-shaped, on a staggered grid. */
  rect(g, s, 2, 5, 46, 59, VIOLET[0]!);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (let row = 0; row < 11; row += 1) {
    const v = 7.5 + row * 4.9;
    for (let k = 0; k < 9; k += 1) {
      const u = 6.5 + k * 5.4 + (row % 2) * 2.7;
      if (u > 44) continue;
      g.fillRect(s.X(u - 1.6), s.Y(v - 0.7), 3.2 * s.kx, 1.4 * s.ky);
      g.fillRect(s.X(u - 0.6), s.Y(v - 1.8), 1.2 * s.kx, 3.6 * s.ky);
    }
  }
  g.restore();
  /* The braces corner to corner. */
  for (const [u0, v0, u1, v1] of [
    [4, 6, 44, 57],
    [44, 6, 4, 57],
  ] as const) {
    g.strokeStyle = VIOLET[3]!;
    g.lineWidth = 2.6 * s.kx;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(s.X(u0), s.Y(v0));
    g.lineTo(s.X(u1), s.Y(v1));
    g.stroke();
    g.strokeStyle = VIOLET[1]!;
    g.lineWidth = 0.9 * s.kx;
    g.stroke();
  }
  /* The frame. */
  const post = (u0: number, u1: number): void => {
    const fill = g.createLinearGradient(s.X(u0), 0, s.X(u1), 0);
    fill.addColorStop(0, VIOLET[3]!);
    fill.addColorStop(1, VIOLET[1]!);
    g.fillStyle = fill;
    g.fillRect(s.X(u0), s.Y(0), s.X(u1) - s.X(u0), s.Y(TILE.h) - s.Y(0));
  };
  post(0, 3);
  post(45, 48);
  for (const [v0, v1] of [
    [0, 6],
    [58, 64],
  ] as const) {
    const fill = g.createLinearGradient(0, s.Y(v0), 0, s.Y(v1));
    fill.addColorStop(0, VIOLET[2]!);
    fill.addColorStop(0.4, VIOLET[3]!);
    fill.addColorStop(1, VIOLET[1]!);
    g.fillStyle = fill;
    g.fillRect(s.X(0), s.Y(v0), s.X(TILE.w) - s.X(0), s.Y(v1) - s.Y(v0));
  }
}

const PAINTERS: readonly ((g: Context, s: Space) => void)[] = [panels, mesh, ventStart, vent, bend, straightPipe, clamped, columns, triangle];

/** Tile `tile` painted with its top left at (`left`, `top`), `kx` and `ky` device pixels a pixel and a line. */
export function paintWallTile(g: Context, tile: number, left: number, top: number, kx: number, ky: number): void {
  const space: Space = { X: (u) => left + u * kx, Y: (v) => top + v * ky, kx, ky };
  g.save();
  g.beginPath();
  g.rect(left, top, TILE.w * kx, TILE.h * ky);
  g.clip();
  PAINTERS[tile]?.(g, space);
  g.restore();
}
