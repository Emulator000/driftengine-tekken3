/**
 * The CRT filter (CRT FILTER in REMAKE OPTION, or `?crt=on`; off by default): the picture as a
 * tape played on a television showed it, laid over the canvas as layers of its own so it is the
 * same on every renderer and at every quality.
 *
 * The picture is softened as a tape softens it: its brightness a little across, its colour much
 * more, smeared to the right of the edges it belongs to. Over it lie soft scanlines, 240 down the
 * picture's height, each a dark band fading in and out; a faint aperture grille of red, green and
 * blue columns; and the corners darkened as a tube's are. The picture under them is a little
 * brighter and richer, which the lines would otherwise dim. Over those, the tape moves: a fine
 * grain crawls, a faint band rolls slowly down, and the picture flickers a little. These are the
 * browser's own animations, so they cost the game's frames nothing, and they hold still where the
 * system asks for less motion.
 *
 * The layers are drawn again whenever the window's size changes, so the lines fall on whole
 * pixels and the softening keeps its share of the picture at any size.
 */
import { canvas } from './page.ts';

/** The scanlines down the picture's height, how dark a line's middle is, and how far the grille and the corners darken. */
const LINES = 240;
const LINE_DARK = 0.42;
const GRILLE = 0.16;
const CORNER_DARK = 0.38;
/** The picture under the layers, lifted against their darkening. */
const LIFT = 'brightness(1.22) contrast(1.06) saturate(1.12)';
/** The tape's softening across the picture, per 1000 CSS pixels of its width: its brightness's blur, its colour's, and how far its colour lies to the right. */
const LUMA_SOFT = 0.9;
const CHROMA_SOFT = 4;
const CHROMA_SHIFT = 1.6;
/** The grain: its tile's side (CSS pixels), how strongly it shows, how many tiles' places it takes in turn, and how many it takes a second. */
const GRAIN_TILE = 160;
const GRAIN = 0.14;
const GRAIN_STEPS = 12;
const GRAIN_RATE = 30;
/** The band rolling down: its height as a share of the picture's, how bright it is, and the seconds it takes. */
const BAND = 0.3;
const BAND_LIGHT = 0.06;
const BAND_SECONDS = 9;
/** The flicker: the most the picture dims, how many dims it steps through, and how many a second. */
const FLICKER = 0.045;
const FLICKER_STEPS = 37;
const FLICKER_RATE = 16;

/** The softening's filter, referenced from the canvas's CSS filter. */
const FILTER_ID = 'tekken3-tape';
const SVG = 'http://www.w3.org/2000/svg';

/** A colour as brightness and two colour differences (each difference raised by a half, so it is never negative), and back. */
const TO_YUV = '0.299 0.587 0.114 0 0  -0.14713 -0.28886 0.436 0 0.5  0.615 -0.51499 -0.10001 0 0.5  0 0 0 0 1';
const TO_RGB = '1 0 1.13983 0 -0.569915  1 -0.39465 -0.5806 0 0.487625  1 2.03211 0 0 -1.016055  0 0 0 0 1';
/** The brightness alone, and the colour differences alone. */
const ONLY_Y = '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1';
const ONLY_UV = '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1';

/** Numbers that look random and are the same each time, from `seed`: each in [0, 1). */
function scattered(count: number, seed: number): number[] {
  let s = seed >>> 0;
  return Array.from({ length: count }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  });
}

export class CrtFilter {
  private readonly layer = document.createElement('canvas');
  private readonly grain = document.createElement('div');
  private readonly band = document.createElement('div');
  private readonly flicker = document.createElement('div');
  private readonly svg = document.createElementNS(SVG, 'svg');
  private readonly softening = softening(this.svg);
  private readonly animations: Animation[] = [];
  private shown = false;
  private size = '';

  constructor() {
    const over = { position: 'absolute', pointerEvents: 'none', display: 'none' };
    Object.assign(this.layer.style, over, { inset: '0', width: '100%', height: '100%', mixBlendMode: 'multiply' });
    Object.assign(this.grain.style, over, { inset: `-${GRAIN_TILE}px`, backgroundImage: `url(${grainTile()})`, backgroundSize: `${GRAIN_TILE}px`, mixBlendMode: 'overlay', opacity: String(GRAIN) });
    Object.assign(this.band.style, over, { left: '0', right: '0', top: '0', height: `${BAND * 100}%`, background: 'linear-gradient(transparent, white 50%, transparent)', mixBlendMode: 'screen', opacity: String(BAND_LIGHT) });
    Object.assign(this.flicker.style, over, { inset: '0', background: 'black', opacity: '0' });
    canvas.after(this.layer, this.grain, this.band, this.flicker, this.svg);
    this.animate();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** Whether the filter is on: shown over the picture, which is softened and lifted under it. */
  set on(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    for (const element of [this.layer, this.grain, this.band, this.flicker]) element.style.display = on ? 'block' : 'none';
    canvas.style.filter = on ? `url(#${FILTER_ID}) ${LIFT}` : '';
    for (const animation of this.animations) {
      if (on) animation.play();
      else animation.pause();
    }
    this.draw();
  }

  get on(): boolean {
    return this.shown;
  }

  /** The grain's crawl, the band's roll and the flicker, paused until the filter is on; none where the system asks for less motion. */
  private animate(): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const at = scattered(GRAIN_STEPS * 2, 3);
    const crawl = Array.from({ length: GRAIN_STEPS }, (_, i) => ({ transform: `translate(${Math.round(at[i * 2]! * GRAIN_TILE)}px, ${Math.round(at[i * 2 + 1]! * GRAIN_TILE)}px)`, easing: 'steps(1, end)' }));
    this.animations.push(this.grain.animate(crawl, { duration: (GRAIN_STEPS * 1000) / GRAIN_RATE, iterations: Infinity }));
    this.animations.push(this.band.animate([{ transform: 'translateY(-100%)' }, { transform: `translateY(${100 / BAND}%)` }], { duration: BAND_SECONDS * 1000, iterations: Infinity }));
    /* Mostly faint, now and then a deeper dip. */
    const dims = scattered(FLICKER_STEPS, 7).map((r) => ({ opacity: String(FLICKER * r ** 2), easing: 'steps(1, end)' }));
    this.animations.push(this.flicker.animate(dims, { duration: (FLICKER_STEPS * 1000) / FLICKER_RATE, iterations: Infinity }));
    for (const animation of this.animations) animation.pause();
  }

  /** The layer at the canvas's size in device pixels: each pixel the lines', the grille's and the corners' darkening multiplied; and the softening at its share of the width. */
  private draw(): void {
    if (!this.shown) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    const size = `${width}x${height}`;
    if (size === this.size) return;
    this.size = size;
    const across = canvas.clientWidth / 1000;
    this.softening.luma.setAttribute('stdDeviation', `${(LUMA_SOFT * across).toFixed(2)} 0`);
    this.softening.chroma.setAttribute('stdDeviation', `${(CHROMA_SOFT * across).toFixed(2)} 0`);
    this.softening.shift.setAttribute('dx', (CHROMA_SHIFT * across).toFixed(2));
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

/**
 * The softening's filter, in `svg`: the picture split into its brightness and its colour, the
 * brightness blurred a little across and the colour much more and moved right, then put back
 * together, kept within the canvas. Its region reaches past the canvas's sides, so the colour moved
 * in at the left edge is an empty picture's neutral rather than none. Its blurs and its shift are
 * sized with the picture.
 */
function softening(svg: SVGSVGElement): { luma: SVGFEGaussianBlurElement; chroma: SVGFEGaussianBlurElement; shift: SVGFEOffsetElement } {
  const node = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>, parent: Element): SVGElementTagNameMap[K] => {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element);
    return element;
  };
  Object.assign(svg.style, { position: 'absolute', width: '0', height: '0' });
  svg.setAttribute('aria-hidden', 'true');
  const filter = node('filter', { id: FILTER_ID, x: '-0.05', y: '0', width: '1.1', height: '1', 'color-interpolation-filters': 'sRGB' }, svg);
  node('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: TO_YUV, result: 'yuv' }, filter);
  const luma = node('feGaussianBlur', { in: 'yuv', stdDeviation: '0', result: 'luma' }, filter);
  node('feColorMatrix', { in: 'luma', type: 'matrix', values: ONLY_Y, result: 'y' }, filter);
  const chroma = node('feGaussianBlur', { in: 'yuv', stdDeviation: '0', result: 'smear' }, filter);
  const shift = node('feOffset', { in: 'smear', dx: '0', dy: '0', result: 'shifted' }, filter);
  node('feColorMatrix', { in: 'shifted', type: 'matrix', values: ONLY_UV, result: 'uv' }, filter);
  node('feComposite', { in: 'y', in2: 'uv', operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0', result: 'together' }, filter);
  node('feColorMatrix', { in: 'together', type: 'matrix', values: TO_RGB, result: 'rgb' }, filter);
  node('feComposite', { in: 'rgb', in2: 'SourceAlpha', operator: 'in' }, filter);
  return { luma, chroma, shift };
}

/** The grain's tile: grey noise about the middle grey, which the overlay leaves the picture as it is on average. */
function grainTile(): string {
  const tile = document.createElement('canvas');
  tile.width = tile.height = GRAIN_TILE;
  const g = tile.getContext('2d');
  if (g === null) return '';
  const image = g.createImageData(GRAIN_TILE, GRAIN_TILE);
  const noise = scattered(GRAIN_TILE * GRAIN_TILE, 11);
  noise.forEach((r, i) => {
    const v = 128 + Math.round((r - 0.5) * 255);
    image.data.set([v, v, v, 255], i * 4);
  });
  g.putImageData(image, 0, 0);
  return tile.toDataURL();
}
