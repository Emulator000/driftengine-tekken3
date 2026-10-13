/**
 * Practice's hit markers painted new at the screen's resolution: a jagged burst ringed in black
 * (orange to a golden core for a level, red for an unblockable), with the level's name over it in
 * chrome letters (HIGH, MID, LOW) or a slanted yellow ! (an unblockable). Painted in the box the
 * original's 48-unit burst fills, so it stretches as the original's did.
 */
import { DISPLAY } from './typefaces.ts';

/** The levels' names by marker (3 is the unblockable's !). */
const LEVELS = ['HIGH', 'MID', 'LOW'] as const;
const BANG = 3;
/** Each spike's length out of the box's half, round from the top; the notches between them. */
const SPIKES = [0.98, 0.86, 0.95, 0.84, 0.99, 0.88, 0.92, 0.83, 0.97, 0.87, 0.94, 0.85, 0.99, 0.89, 0.91, 0.82, 0.96, 0.86];
const NOTCH = 0.7;
/** The burst's rings from the outside in (their size out of the whole, their colour): a level's, an unblockable's. */
const RINGS: Readonly<Record<'level' | 'bang', readonly (readonly [number, string])[]>> = {
  level: [
    [1, '#d82808'],
    [0.9, '#f06010'],
    [0.8, '#f59818'],
  ],
  bang: [
    [1, '#b00404'],
    [0.9, '#e40c0c'],
    [0.8, '#ff1e14'],
  ],
};
/** The burst's core's light, middle to edge. */
const CORES = { level: ['#ffd040', '#f5a018'], bang: ['#ff4a30', '#f01810'] } as const;
/** A label's height and the !'s width, out of the box's. */
const LABEL = 16 / 48;
const BANG_WIDTH = 12 / 48;

/** The burst's outline scaled about the box's middle. */
function star(g: OffscreenCanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, scale: number): void {
  g.beginPath();
  const points = SPIKES.length * 2;
  for (let i = 0; i < points; i += 1) {
    const turn = (i / points) * Math.PI * 2 - Math.PI / 2;
    const reach = (i % 2 === 0 ? SPIKES[i / 2]! : NOTCH) * scale;
    const [px, py] = [x + Math.cos(turn) * rx * reach, y + Math.sin(turn) * ry * reach];
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** The burst: a black rim, its rings, then its core lit from the middle. */
function burst(g: OffscreenCanvasRenderingContext2D, kind: 'level' | 'bang', left: number, top: number, w: number, h: number): void {
  const [x, y] = [left + w / 2, top + h / 2];
  const [rx, ry] = [w / 2 - Math.max(1, w * 0.02), h / 2 - Math.max(1, h * 0.02)];
  g.lineJoin = 'miter';
  star(g, x, y, rx, ry, 1);
  g.lineWidth = Math.max(1.5, Math.min(w, h) * 0.05);
  g.strokeStyle = '#140804';
  g.stroke();
  for (const [scale, colour] of RINGS[kind]) {
    star(g, x, y, rx, ry, scale);
    g.fillStyle = colour;
    g.fill();
  }
  const [inner, outer] = CORES[kind];
  const light = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry) * 0.5);
  light.addColorStop(0, inner);
  light.addColorStop(1, outer);
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.beginPath();
  g.arc(0, 0, rx * NOTCH * 0.86, 0, Math.PI * 2);
  g.restore();
  g.fillStyle = light;
  g.fill();
}

/** A level's name across the middle: chrome letters, white to grey, ringed in black over a shadow. */
function label(g: OffscreenCanvasRenderingContext2D, text: string, left: number, top: number, w: number, h: number): void {
  const height = h * LABEL;
  const [x, y] = [left + w / 2, top + h / 2];
  const size = height * 1.05;
  g.font = `${DISPLAY.weight} ${size}px "${DISPLAY.family}", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const width = w * 0.94;
  const rim = Math.max(1.5, size * 0.16);
  g.lineJoin = 'round';
  g.lineWidth = rim * 2;
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.strokeText(text, x + rim * 0.6, y + rim * 0.8, width);
  g.strokeStyle = '#0c0c0c';
  g.strokeText(text, x, y, width);
  const chrome = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  chrome.addColorStop(0, '#ffffff');
  chrome.addColorStop(0.45, '#f2f2f2');
  chrome.addColorStop(0.55, '#a8a8a8');
  chrome.addColorStop(1, '#e0e0e0');
  g.fillStyle = chrome;
  g.fillText(text, x, y, width);
}

/** The unblockable's !: a slanted yellow stroke and its dot, ringed in red then black. */
function bang(g: OffscreenCanvasRenderingContext2D, left: number, top: number, w: number, h: number): void {
  const across = w * BANG_WIDTH;
  const x0 = left + (w - across) / 2;
  const at = (u: number, v: number): [number, number] => [x0 + u * across, top + v * h];
  const shape = (): void => {
    g.beginPath();
    g.moveTo(...at(0.62, 0.12));
    g.lineTo(...at(0.98, 0.15));
    g.lineTo(...at(0.5, 0.66));
    g.lineTo(...at(0.36, 0.64));
    g.closePath();
    const [dx, dy] = at(0.28, 0.82);
    g.moveTo(dx + across * 0.17, dy);
    g.ellipse(dx, dy, across * 0.17, h * 0.055, 0, 0, Math.PI * 2);
  };
  g.lineJoin = 'round';
  shape();
  g.lineWidth = Math.max(2, across * 0.3);
  g.strokeStyle = '#140804';
  g.stroke();
  g.lineWidth = Math.max(1, across * 0.14);
  g.strokeStyle = '#d40c0c';
  g.stroke();
  g.fillStyle = '#ffee10';
  g.fill();
}

/** A marker (0 HIGH, 1 MID, 2 LOW, 3 the unblockable's !) painted in its burst's box (device pixels). */
export function paintMarker(g: OffscreenCanvasRenderingContext2D, marker: number, left: number, top: number, w: number, h: number): void {
  burst(g, marker === BANG ? 'bang' : 'level', left, top, w, h);
  if (marker === BANG) bang(g, left, top, w, h);
  else label(g, LEVELS[marker] ?? LEVELS[0], left, top, w, h);
}
