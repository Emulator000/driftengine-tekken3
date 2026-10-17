/**
 * The CRT filter (CRT FILTER in REMAKE OPTION, or `?crt=on`; off by default): the picture as a
 * television showed it, laid over the canvas as a layer of its own so it is the same on every
 * renderer and at every quality. Soft scanlines, 240 down the picture's height, each a dark band
 * fading in and out; a faint aperture grille of red, green and blue columns; the corners darkened
 * as a tube's are; and the picture under them a little brighter and richer, which the lines would
 * otherwise dim. The layer is drawn again whenever the window's size changes, so its lines fall on
 * whole pixels at any size.
 */
import { canvas } from './page.ts';

/** The scanlines down the picture's height, how dark a line's middle is, and how far the grille and the corners darken. */
const LINES = 240;
const LINE_DARK = 0.42;
const GRILLE = 0.16;
const CORNER_DARK = 0.38;
/** The picture under the layer, lifted against its darkening. */
const LIFT = 'brightness(1.22) contrast(1.06) saturate(1.12)';

export class CrtFilter {
  private readonly layer = document.createElement('canvas');
  private shown = false;
  private size = '';

  constructor() {
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'multiply', display: 'none' });
    canvas.after(this.layer);
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** Whether the filter is on: shown over the picture, which is lifted under it. */
  set on(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.layer.style.display = on ? 'block' : 'none';
    canvas.style.filter = on ? LIFT : '';
    this.draw();
  }

  get on(): boolean {
    return this.shown;
  }

  /** The layer at the canvas's size in device pixels: each pixel the lines', the grille's and the corners' darkening multiplied. */
  private draw(): void {
    if (!this.shown) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    const size = `${width}x${height}`;
    if (size === this.size) return;
    this.size = size;
    this.layer.width = width;
    this.layer.height = height;
    const g = this.layer.getContext('2d');
    if (g === null) return;
    const image = g.createImageData(width, height);
    const pixels = image.data;
    const pitch = height / LINES;
    const [cx, cy] = [width / 2, height / 2];
    /* The corners' darkening: none in the middle, growing toward them as a tube's picture falls off. */
    const reach = Math.hypot(cx, cy);
    for (let y = 0; y < height; y += 1) {
      /* A line's band: darkest between two lines' middles, none at a line's own. */
      const band = 0.5 - 0.5 * Math.cos(((y + 0.5) / pitch) * 2 * Math.PI);
      const line = 1 - LINE_DARK * band;
      const dy = (y - cy) / reach;
      for (let x = 0; x < width; x += 1) {
        const dx = (x - cx) / reach;
        const fall = Math.max(0, Math.hypot(dx, dy) - 0.55) / 0.45;
        const corner = 1 - CORNER_DARK * fall * fall;
        const shade = line * corner;
        /* The grille: each column one of the three colours, the other two a little dimmer there. */
        const column = x % 3;
        const at = (y * width + x) * 4;
        pixels[at] = 255 * shade * (column === 0 ? 1 : 1 - GRILLE);
        pixels[at + 1] = 255 * shade * (column === 1 ? 1 : 1 - GRILLE);
        pixels[at + 2] = 255 * shade * (column === 2 ? 1 : 1 - GRILLE);
        pixels[at + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  }
}
