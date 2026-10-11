/**
 * The shapes the effects draw as sprites, painted in code at a high resolution: the original's
 * concepts drawn new, never its sheets. One sheet of 4 × 4 cells, white on clear, tinted per
 * effect and added onto the picture; a particle's frame names its cell and its spin turns it.
 */

/** The sheet's cells, a particle's frame. */
export const Shape = {
  RING: 0,
  STAR_FOUR: 1,
  STAR_EIGHT: 2,
  BLOB: 3,
  CRESCENT: 4,
  FAN: 5,
  GLOW: 6,
  FLAME: 7,
  BAR: 8,
} as const;

export const SHAPE_CELLS = [4, 4] as const;

/** A number generator from a seed, the same sequence every time. */
function generator(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

type Context = OffscreenCanvasRenderingContext2D;

/** A soft round light at a point: white at its centre, fading to clear at `radius`. */
function softDot(g: Context, x: number, y: number, radius: number, strength: number): void {
  const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255,255,255,${strength})`);
  gradient.addColorStop(0.4, `rgba(255,255,255,${strength * 0.45})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
}

/** A spike from the centre: a thin diamond `length` long, `width` wide at its base. */
function spike(g: Context, cx: number, cy: number, angle: number, length: number, width: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const gradient = g.createLinearGradient(cx, cy, cx + dx * length, cy + dy * length);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.beginPath();
  g.moveTo(cx - dy * width, cy + dx * width);
  g.lineTo(cx + dx * length, cy + dy * length);
  g.lineTo(cx + dy * width, cy - dx * width);
  g.closePath();
  g.fill();
}

const painters: readonly ((g: Context, cx: number, cy: number, r: number) => void)[] = [
  /* A ring: a thin bright line with a soft glow either side. */
  (g, cx, cy, r) => {
    for (const [width, alpha] of [
      [r * 0.16, 0.18],
      [r * 0.08, 0.4],
      [r * 0.025, 1],
    ] as const) {
      g.strokeStyle = `rgba(255,255,255,${alpha})`;
      g.lineWidth = width;
      g.beginPath();
      g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      g.stroke();
    }
  },
  /* A four-point star, its long arms across and down. */
  (g, cx, cy, r) => {
    softDot(g, cx, cy, r * 0.35, 1);
    for (let i = 0; i < 4; i += 1) spike(g, cx, cy, (i * Math.PI) / 2, r * 0.98, r * 0.06);
  },
  /* An eight-point star: four long arms and four short. */
  (g, cx, cy, r) => {
    softDot(g, cx, cy, r * 0.3, 1);
    for (let i = 0; i < 8; i += 1) spike(g, cx, cy, (i * Math.PI) / 4, r * (i % 2 === 0 ? 0.95 : 0.55), r * 0.05);
  },
  /* A soft blob of energy, lumpy: overlapping soft lights about the centre. */
  (g, cx, cy, r) => {
    const random = generator(0xb10b);
    softDot(g, cx, cy, r * 0.75, 0.8);
    for (let i = 0; i < 14; i += 1) {
      const a = random() * Math.PI * 2;
      const d = random() * r * 0.45;
      softDot(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.25 + random() * 0.3), 0.35 + random() * 0.35);
    }
  },
  /* A crescent, thick at its middle and tapering to points, its opening to the left. */
  (g, cx, cy, r) => {
    g.save();
    g.shadowColor = 'rgba(255,255,255,0.8)';
    g.shadowBlur = r * 0.12;
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.arc(cx, cy, r * 0.82, -Math.PI * 0.42, Math.PI * 0.42);
    g.arc(cx - r * 0.18, cy, r * 0.74, Math.PI * 0.4, -Math.PI * 0.4, true);
    g.closePath();
    g.fill();
    g.restore();
  },
  /* A spray: fine droplets fanning out to the right from a dense start at the centre. */
  (g, cx, cy, r) => {
    const random = generator(0x5947);
    softDot(g, cx, cy, r * 0.3, 0.9);
    for (let i = 0; i < 220; i += 1) {
      const along = random() ** 0.7 * r * 0.95;
      const spread = (random() - 0.5) * 0.9 * (0.3 + along / r);
      const x = cx + Math.cos(spread) * along;
      const y = cy + Math.sin(spread) * along;
      softDot(g, x, y, r * (0.012 + random() * 0.03) * (1.4 - along / r), 0.5 + random() * 0.5);
    }
  },
  /* A soft glow. */
  (g, cx, cy, r) => softDot(g, cx, cy, r * 0.95, 1),
  /* A flame tongue: a teardrop pointing right, bright at its root. */
  (g, cx, cy, r) => {
    const gradient = g.createLinearGradient(cx - r * 0.5, cy, cx + r * 0.95, cy);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(cx + r * 0.95, cy);
    g.quadraticCurveTo(cx + r * 0.2, cy - r * 0.32, cx - r * 0.35, cy - r * 0.2);
    g.quadraticCurveTo(cx - r * 0.6, cy, cx - r * 0.35, cy + r * 0.2);
    g.quadraticCurveTo(cx + r * 0.2, cy + r * 0.32, cx + r * 0.95, cy);
    g.fill();
  },
  /* A bar of light across the cell: a hard bright line in a soft glow, its ends rounded off. */
  (g, cx, cy, r) => {
    const across = g.createLinearGradient(0, cy - r, 0, cy + r);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.3, 'rgba(255,255,255,0.18)');
    across.addColorStop(0.44, 'rgba(255,255,255,0.6)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.56, 'rgba(255,255,255,0.6)');
    across.addColorStop(0.7, 'rgba(255,255,255,0.18)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalCompositeOperation = 'destination-in';
    const ends = g.createLinearGradient(cx - r, 0, cx + r, 0);
    ends.addColorStop(0, 'rgba(255,255,255,0)');
    ends.addColorStop(0.06, 'rgba(255,255,255,1)');
    ends.addColorStop(0.94, 'rgba(255,255,255,1)');
    ends.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ends;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  },
];

/** The shapes' sheet, `cell` pixels a cell. */
export function shapeSheet(cell: number): ImageData {
  const [columns, rows] = SHAPE_CELLS;
  const canvas = new OffscreenCanvas(cell * columns, cell * rows);
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('no 2D context for the effects sheet');
  painters.forEach((paint, i) => {
    const x = (i % columns) * cell;
    const y = Math.floor(i / columns) * cell;
    g.save();
    g.beginPath();
    g.rect(x, y, cell, cell);
    g.clip();
    paint(g, x + cell / 2, y + cell / 2, cell / 2);
    g.restore();
  });
  return g.getImageData(0, 0, canvas.width, canvas.height);
}
