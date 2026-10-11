/**
 * The character select's frame drawn new, on the original's exact lines: navy steel pillars at the
 * screen's edges; below the portraits a stepped band of navy steel rising to a bump at the middle,
 * hazard chevrons across its lower part (mirrored about the middle, at 45° on the console's tall
 * pixels); a silver bar with angled wings at its ends and side walls down to the slot's foot; and
 * the brushed foot under the slot with its tab. Every corner is the original's, in its pixels
 * (368 across) and lines (480 down); everything is painted at the display's resolution. Two rows
 * of characters move the band and bar up 34 lines and the foot down 20.
 *
 * Across a window wider than the original's screen the ends (the pillars, shoulders, wings and the
 * slot's walls) stand at the window's edges, the middle in its place, and the flats between run on
 * from one to the other: one painting across the window, its chevrons on one grid, its shading and
 * brushing laid across the window, so that it can be cut into strips that meet without a seam.
 */
type Context = OffscreenCanvasRenderingContext2D;
type Point = readonly [number, number];

/** How far the middle piece moves up, and the foot down, with two rows. */
const TWO_ROWS = { middle: -34, foot: 20 } as const;
/** The band's lines (one row): the shoulders' top, the flats the chevrons start on, the bar's top and its foot. */
const BAND = { shoulder: 322, stripes: 338, bar: 351, barFoot: 364 } as const;
/** The chevrons: their period across, the yellow's share, how far they lean a line (pixels), the middle they mirror about. */
const CHEVRON = { period: 27, yellow: 0.5, lean: 0.6, middle: 184 } as const;

const TOP_PILLAR: readonly Point[] = [
  [0, 0],
  [12, 0],
  [12, 71],
  [0, 85],
];

/** The band's navy body: the left pillar, the stepped edge to the bump and back, the right pillar, closed under the bar's top. */
const BAND_BODY: readonly Point[] = [
  [0, 245],
  [6, 252],
  [6, 322],
  [13, 322],
  [23, 338],
  [61, 338],
  [66, 346],
  [80, 346],
  [83, 351],
  [112, 351],
  [115, 346],
  [128, 346],
  [133, 338],
  [169, 338],
  [177, 326],
  [191, 326],
  [199, 338],
  [235, 338],
  [240, 346],
  [253, 346],
  [256, 351],
  [285, 351],
  [288, 346],
  [302, 346],
  [307, 338],
  [345, 338],
  [355, 322],
  [362, 322],
  [362, 252],
  [368, 245],
  [368, 352],
  [0, 352],
];

/** The silver: the wings, the bar (split at the middle below its face) and the side walls down to the gap above the foot. */
const SILVER_BODY: readonly Point[] = [
  [0, 340],
  [11, 340],
  [23, 351],
  [345, 351],
  [357, 340],
  [368, 340],
  [368, 401],
  [363, 401],
  [363, 380],
  [358, 372],
  [358, 365],
  [344, 365],
  [344, 364],
  [24, 364],
  [24, 365],
  [10, 365],
  [10, 372],
  [5, 380],
  [5, 401],
  [0, 401],
];

/** The foot under the slot, the tab in its middle. */
const FOOT: readonly Point[] = [
  [0, 404],
  [6, 404],
  [5, 405],
  [5, 427],
  [10, 432],
  [10, 441],
  [151, 441],
  [154, 446],
  [215, 446],
  [217, 441],
  [358, 441],
  [358, 432],
  [363, 427],
  [363, 405],
  [362, 404],
  [368, 404],
  [368, 480],
  [0, 480],
];
/** The ends' reach in from each side: what lies within it stands at the window's edge. */
const ENDS = { left: 24, right: 344 } as const;

const NAVY = { light: '#323b52', mid: '#1d2333', dark: '#0e1119', rim: '#56627e' } as const;
const YELLOW = { light: '#e2b860', mid: '#c99a3c', dark: '#9c7228' } as const;

/** A number generator from a seed, the same every time. */
function generator(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Where a painting of the frame goes: the window's units `from` to `to` across and lines
 * `lineFrom` to `lineTo` down, painted at `left`, `top` (device pixels), `kx` and `ky` device
 * pixels a unit and a line; the window's edges in units, `edges`.
 */
export interface FrameView {
  readonly left: number;
  readonly top: number;
  readonly from: number;
  readonly to: number;
  readonly lineFrom: number;
  readonly lineTo: number;
  readonly kx: number;
  readonly ky: number;
  readonly edges: { readonly left: number; readonly right: number };
}

/** The frame's space on the display: x in the window's units, y in the original's lines; `at` takes the original's pixels to the window's (its ends to the edges). */
interface Space {
  readonly X: (u: number) => number;
  readonly Y: (l: number) => number;
  readonly at: (u: number) => number;
  readonly ky: number;
}

/** A polygon of the original's corners, its ends moved to the window's edges, down `dy` lines. */
function polygon(space: Space, points: readonly Point[], dy = 0, place = true): Path2D {
  const p = new Path2D();
  points.forEach(([u, l], i) => {
    const x = space.X(place ? space.at(u) : u);
    if (i === 0) p.moveTo(x, space.Y(l + dy));
    else p.lineTo(x, space.Y(l + dy));
  });
  p.closePath();
  return p;
}

/**
 * Fine streaks, as brushed metal has, light and dark, over the window's units `from` to `to` and
 * the lines `top` to `bottom`: as many to a unit and a line wherever they are, the same wherever
 * the painting is cut (the seed and the window's span fix them).
 */
function streaks(g: Context, space: Space, from: number, to: number, top: number, bottom: number, seed: number, strength = 1): void {
  const random = generator(seed);
  const count = Math.round(((to - from) * (bottom - top)) / 30);
  for (let i = 0; i < count; i += 1) {
    const line = top + random() * (bottom - top);
    const light = random() < 0.5;
    const alpha = (light ? 0.04 + random() * 0.1 : 0.03 + random() * 0.08) * strength;
    const width = 0.5 + random() * 0.9;
    const start = from + random() * (to - from);
    const length = 12 + random() * 60;
    g.strokeStyle = light ? `rgba(255, 255, 255, ${alpha})` : `rgba(10, 14, 24, ${alpha})`;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(space.X(start), space.Y(line));
    g.lineTo(space.X(start + length), space.Y(line));
    g.stroke();
  }
}

/** Navy steel over a region: a cool gradient from lit to deep, faint grain, its rim lit. */
function navy(g: Context, space: Space, region: Path2D, top: number, bottom: number, scale: number, span: readonly [number, number]): void {
  const body = g.createLinearGradient(0, space.Y(top), 0, space.Y(bottom));
  body.addColorStop(0, NAVY.light);
  body.addColorStop(0.4, NAVY.mid);
  body.addColorStop(1, NAVY.dark);
  g.fillStyle = body;
  g.fill(region);
  g.save();
  g.clip(region);
  streaks(g, space, span[0], span[1], top, bottom, 0x2a7, 0.6);
  g.restore();
  g.strokeStyle = NAVY.rim;
  g.lineWidth = Math.max(1, scale * 0.5);
  g.stroke(region);
}

/** The frame painted over `view`, `rows` the select's (0 one, 1 two). */
export function paintSelectFrame(g: Context, view: FrameView, rows: number): void {
  const { kx, ky } = view;
  const [L, R] = [view.edges.left, view.edges.right];
  const space: Space = {
    X: (u) => view.left + (u - view.from) * kx,
    Y: (l) => view.top + (l - view.lineFrom) * ky,
    at: (u) => (u <= ENDS.left ? L + u : u >= ENDS.right ? R - 368 + u : u),
    ky,
  };
  const { X, Y } = space;
  const span = [L, R] as const;
  const dm = rows === 0 ? 0 : TWO_ROWS.middle;
  const df = rows === 0 ? 0 : TWO_ROWS.foot;
  g.save();
  g.beginPath();
  g.rect(view.left, view.top, (view.to - view.from) * kx, (view.lineTo - view.lineFrom) * ky);
  g.clip();
  /* The top pillars. */
  for (const mirror of [false, true]) navy(g, space, polygon(space, TOP_PILLAR.map(([u, l]) => [mirror ? 368 - u : u, l] as const)), 0, 85, ky, span);
  /* The band. */
  const band = polygon(space, BAND_BODY, dm);
  const bandTop = BAND.shoulder + dm;
  const bandFoot = 352 + dm;
  navy(g, space, band, bandTop, bandFoot, ky, span);
  /* The chevrons over the band's lower part, on one grid across the window, mirrored about the middle, the middle one widening under the bump. */
  g.save();
  g.clip(band);
  const top0 = BAND.stripes + dm;
  const half = (CHEVRON.period * CHEVRON.yellow) / 2;
  const chevron = (points: readonly Point[]): void => {
    const fill = g.createLinearGradient(0, Y(top0), 0, Y(bandFoot));
    fill.addColorStop(0, YELLOW.light);
    fill.addColorStop(0.6, YELLOW.mid);
    fill.addColorStop(1, YELLOW.dark);
    g.fillStyle = fill;
    g.fill(polygon(space, points, 0, false));
  };
  const reach = Math.ceil(Math.max(CHEVRON.middle - L, R - CHEVRON.middle) / CHEVRON.period) + 2;
  for (let k = 1; k <= reach; k += 1) {
    for (const side of [-1, 1]) {
      const centre = CHEVRON.middle + side * k * CHEVRON.period;
      const at = (line: number, u: number): Point => [u + side * CHEVRON.lean * (line - top0), line];
      chevron([at(top0, centre - half), at(top0, centre + half), at(bandFoot, centre + half), at(bandFoot, centre - half)]);
    }
  }
  const widen = (line: number): number => half + CHEVRON.lean * (line - top0);
  chevron([
    [CHEVRON.middle - widen(top0), top0],
    [CHEVRON.middle + widen(top0), top0],
    [CHEVRON.middle + widen(bandFoot), bandFoot],
    [CHEVRON.middle - widen(bandFoot), bandFoot],
  ]);
  g.restore();
  /* The silver: wings, bar, walls; the bar's top a bright line, a shadow under its face. */
  const silverTop = 340 + dm;
  const silverFoot = 401 + dm;
  const silver = polygon(space, SILVER_BODY, dm);
  const body = g.createLinearGradient(0, Y(silverTop), 0, Y(silverFoot));
  body.addColorStop(0, '#dfe3ec');
  body.addColorStop(0.2, '#f6f8fc');
  body.addColorStop(0.4, '#b9bfcc');
  body.addColorStop(1, '#5c6272');
  g.fillStyle = body;
  g.fill(silver);
  g.save();
  g.clip(silver);
  streaks(g, space, L, R, silverTop, silverFoot, 0x51a);
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.fillRect(X(L), Y(BAND.bar + dm), X(R) - X(L), Math.max(1, ky * 1.4));
  g.fillStyle = 'rgba(20, 24, 36, 0.75)';
  g.fillRect(X(L), Y(BAND.barFoot - 1.6 + dm), X(R) - X(L), Math.max(1, ky * 1.6));
  g.restore();
  g.strokeStyle = 'rgba(40, 46, 60, 0.9)';
  g.lineWidth = Math.max(1, ky * 0.6);
  g.stroke(silver);
  /* The foot, brushed, darkening toward the window's edges and below, a bright line along its top. */
  const footTop = 404 + df;
  const footLine = 441 + df;
  const foot = polygon(space, FOOT, df);
  const across = g.createLinearGradient(X(L), 0, X(R), 0);
  const ends = Math.min(0.35, (0.35 * 368) / (R - L));
  across.addColorStop(0, '#4c5262');
  across.addColorStop(ends * 0.34, '#8c92a2');
  across.addColorStop(ends, '#d7dbe5');
  across.addColorStop(0.5, '#eef0f6');
  across.addColorStop(1 - ends, '#d7dbe5');
  across.addColorStop(1 - ends * 0.34, '#8c92a2');
  across.addColorStop(1, '#4c5262');
  g.fillStyle = across;
  g.fill(foot);
  g.save();
  g.clip(foot);
  const down = g.createLinearGradient(0, Y(footLine), 0, Y(480));
  down.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
  down.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  g.fillStyle = down;
  g.fillRect(X(L), Y(footTop), X(R) - X(L), Y(480) - Y(footTop));
  streaks(g, space, L, R, footTop, 480, 0xf007);
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.fillRect(X(L), Y(footLine), X(R) - X(L), Math.max(1, ky * 1.2));
  g.restore();
  g.strokeStyle = 'rgba(40, 46, 60, 0.9)';
  g.lineWidth = Math.max(1, ky * 0.6);
  g.stroke(foot);
  g.restore();
}
