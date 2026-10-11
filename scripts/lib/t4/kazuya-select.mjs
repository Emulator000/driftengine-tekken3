/**
 * Kazuya's pictures for the select and versus screens: his portrait and its two grid icons from
 * Tekken 4's art of him, and his name for the select's name sheet.
 *
 * Tekken 3's pictures are drawn with pixels 5/3 as wide as they are tall (368 across the screen's
 * 480 lines), so they are kept that much narrower than they show; Tekken 4's art is square.
 *
 * The art is Tekken 4's render of his head and shoulders (`.cache/art/kazuya-portrait.png`, 1000 by
 * 751 on a grey gradient), or when that is not there its select picture of him (file 118, picture 14,
 * his character id), a smaller close-up. Either is cut out (the render keyed off its gradient, the
 * select picture's own alpha) and framed as Tekken 3 frames a portrait; Tekken 3's run down to the
 * chest and Tekken 4's stop at the shoulders, so his chest below is drawn from his own model
 * (`kazuya-art.mjs`), coloured as the art's skin, the art's last rows fading into it.
 *
 * - The portrait, as Tekken 3's (the select's and the versus screen's own files): 126 by 252, 8
 *   bits, its 256 colours four palettes of 64, one for each 64 lines (the select moves the palette
 *   as it draws them); colour 0 is clear, the light behind showing through, every other one opaque.
 *   His head is as high as Heihachi's and a little larger, the hair the art cuts off where the
 *   select fades a portrait in (the look's bands 0: the first 30 lines), his chest where it fades it
 *   out (the last 60).
 * - The icons, as Tekken 3's: the single row's 32 by 68 and the double rows' 32 by 58, 8 bits with a
 *   palette each, his head over a gradient (his, Tekken 4's icon's red): from the top of his hair to
 *   below his chin in the first, brow to chin in the second. Their palettes have 64 colours, so each
 *   fits the free VRAM the game puts them in.
 * - The name, as the sheet's (the select overlay's member 44): 4 bits, 128 by 16, the same values
 *   as the fight's name picture (`kazuya-name.mjs`), no palette (the sheet's own draws it).
 *
 * `kazuyaArt` puts the four TIMs back to back in that order, every one placed at (0, 0): the game
 * uploads each where it decides.
 */
import { readTim2Pictures } from './tim2.mjs';

const KAZUYA = 14;

/** The area of `rgba` (`width` across) inside `crop`, averaged into `outW` by `outH`, colours weighted by alpha. */
function resample({ rgba, width }, crop, outW, outH) {
  const out = new Float64Array(outW * outH * 4);
  const sx = crop.w / outW;
  const sy = crop.h / outH;
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let v = Math.floor(crop.y + y * sy); v < Math.ceil(crop.y + (y + 1) * sy); v += 1) {
        for (let u = Math.floor(crop.x + x * sx); u < Math.ceil(crop.x + (x + 1) * sx); u += 1) {
          n += 1;
          if (u < 0 || v < 0 || u >= width || v * width + u >= rgba.length / 4) continue;
          const o = (v * width + u) * 4;
          const w = rgba[o + 3] / 255;
          r += rgba[o] * w;
          g += rgba[o + 1] * w;
          b += rgba[o + 2] * w;
          a += w;
        }
      }
      const at = (y * outW + x) * 4;
      out[at] = a > 0 ? r / a : 0;
      out[at + 1] = a > 0 ? g / a : 0;
      out[at + 2] = a > 0 ? b / a : 0;
      out[at + 3] = n > 0 ? a / n : 0;
    }
  }
  return out;
}

/** `count` colours that stand for `colours` (k-means, seeded spread out), and each colour's nearest. */
function quantize(colours, count) {
  const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centres = [];
  if (colours.length === 0) return { centres: [[0, 0, 0]], nearest: [] };
  centres.push(colours[0]);
  const best = colours.map((c) => distance(c, centres[0]));
  while (centres.length < Math.min(count, colours.length)) {
    let far = 0;
    for (let i = 1; i < colours.length; i += 1) if (best[i] > best[far]) far = i;
    if (best[far] === 0) break;
    centres.push(colours[far]);
    for (let i = 0; i < colours.length; i += 1) best[i] = Math.min(best[i], distance(colours[i], colours[far]));
  }
  let nearest = new Array(colours.length).fill(0);
  for (let round = 0; round < 12; round += 1) {
    nearest = colours.map((c) => {
      let k = 0;
      for (let j = 1; j < centres.length; j += 1) if (distance(c, centres[j]) < distance(c, centres[k])) k = j;
      return k;
    });
    const sums = centres.map(() => [0, 0, 0, 0]);
    colours.forEach((c, i) => {
      const s = sums[nearest[i]];
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
      s[3] += 1;
    });
    sums.forEach((s, j) => {
      if (s[3] > 0) centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  return { centres, nearest };
}

/** How much wider than tall Tekken 3's pixels show. */
const PIXEL_ASPECT = 5 / 3;
/** The portrait, and as it shows (`PIXEL_ASPECT` wider), drawn at twice that. */
const PORTRAIT_WIDTH = 126;
const PORTRAIT_HEIGHT = 252;
const SHOWN_WIDTH = Math.round(PORTRAIT_WIDTH * PIXEL_ASPECT);
const FINE = 2;
/** His head in it: the top of his hair's line and how many lines down his chin is (Heihachi's: 33 and 130). */
const CROWN_LINE = 28;
const HEAD_LINES = 134;
/** Where the art fades into his drawn chest, and how far up the art's cut hair fades in, in lines. */
const CHEST_FADE = 14;
const HAIR_FADE = 3;
/**
 * Where his head is in each art: the rows of the top of his hair (above the picture when it is cut
 * off) and of his chin, and his neck's base (column and row: between his shoulders, below the
 * picture), which his drawn chest is placed by.
 */
const RENDER_FRAMING = { crown: -10, chin: 650, neck: [445, 800] };
const SELECT_FRAMING = { crown: -5, chin: 255, neck: [118, 330] };
/** An icon's colours: a quarter of the 8-bit palette. */
const ICON_COLOURS = 64;
const NAME_WIDTH = 128;
const NAME_HEIGHT = 16;

/** A colour as the PlayStation's 15 bits, its top bit set so it draws even when black. */
const toPlayStation = ([r, g, b]) => 0x8000 | (Math.min(31, Math.round(b / 8)) << 10) | (Math.min(31, Math.round(g / 8)) << 5) | Math.min(31, Math.round(r / 8));

/** An 8-bit TIM: its 256 colours and its indices, `width` by `height`, both placed at (0, 0) (the game loads them where it wants). */
function tim8(palette, indices, width, height) {
  const bytes = new Uint8Array(8 + 12 + 512 + 12 + width * height);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x10, true);
  view.setUint32(4, 9, true);
  view.setUint32(8, 12 + 512, true);
  view.setUint16(16, 256, true);
  view.setUint16(18, 1, true);
  palette.forEach((c, i) => view.setUint16(20 + i * 2, c, true));
  const image = 20 + 512;
  view.setUint32(image, 12 + width * height, true);
  view.setUint16(image + 8, width / 2, true);
  view.setUint16(image + 10, height, true);
  bytes.set(indices, image + 12);
  return bytes;
}

/** The ordered dither's threshold at a pixel (4 by 4, 0 to 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const threshold = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/**
 * A picture on a grey gradient (each row's grey running from the left edge's to the right edge's)
 * cut out: alpha by how far a pixel's colour is from the grey behind it, the edges' colours with the
 * grey taken out. The grey is read off the edges' first columns while they are grey, and carried on
 * below (where his shoulders reach the edges) as a curve fitted to the last 300 rows read. Whatever
 * the background, spreading from the picture's border through the clear, cannot reach is him.
 */
export function matteOnGradient({ width, height, rgba }) {
  const at = (x, y) => (y * width + x) * 4;
  const isGrey = (x, y) => {
    const o = at(x, y);
    return Math.abs(rgba[o] - rgba[o + 1]) < 10 && Math.abs(rgba[o + 1] - rgba[o + 2]) < 12;
  };
  const edge = (columns) => {
    const rows = [];
    for (let y = 0; y < height && columns.every((x) => isGrey(x, y)); y += 1) {
      rows.push([0, 1, 2].map((c) => columns.reduce((sum, x) => sum + rgba[at(x, y) + c], 0) / columns.length));
    }
    if (rows.length < 300) throw new Error('the picture is not on a grey gradient');
    const fit = [0, 1, 2].map((c) => fitQuadratic(rows.slice(-300).map((r, k) => [rows.length - 300 + k, r[c]])));
    return (y, c) => (y < rows.length ? rows[y][c] : fit[c][0] + fit[c][1] * y + fit[c][2] * y * y);
  };
  const left = edge([0, 1, 2, 3, 4]);
  const right = edge([0, 1, 2, 3, 4].map((k) => width - 1 - k));
  const grey = (x, y, c) => left(y, c) + (right(y, c) - left(y, c)) * (x / (width - 1));
  const alpha = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(...[0, 1, 2].map((c) => rgba[at(x, y) + c] - grey(x, y, c)));
      alpha[y * width + x] = Math.min(1, Math.max(0, (d - 8) / 32));
    }
  }
  const outside = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  while (stack.length > 0) {
    const i = stack.pop();
    if (outside[i] || alpha[i] >= 0.5) continue;
    outside[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const edgeOf = [i - 1, i + 1, i - width, i + width].some((j) => j >= 0 && j < width * height && outside[j]);
      const a = outside[i] || edgeOf ? alpha[i] : 1;
      for (let c = 0; c < 3; c += 1) {
        const g = grey(x, y, c);
        out[i * 4 + c] = a > 0 ? Math.max(0, Math.min(255, Math.round(g + (rgba[i * 4 + c] - g) / a))) : 0;
      }
      out[i * 4 + 3] = Math.round(a * 255);
    }
  }
  return { width, height, rgba: out };
}

/** The least-squares `[a, b, c]` of `a + b x + c x²` through `points` (`[x, y]` each). */
function fitQuadratic(points) {
  const s = [0, 0, 0, 0, 0];
  const t = [0, 0, 0];
  for (const [x, y] of points) {
    for (let k = 0; k < 5; k += 1) s[k] += x ** k;
    for (let k = 0; k < 3; k += 1) t[k] += y * x ** k;
  }
  const m = [
    [s[0], s[1], s[2]],
    [s[1], s[2], s[3]],
    [s[2], s[3], s[4]],
  ];
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((v, j) => (j === k ? t[i] : v)))) / d);
}

/** Each colour channel's mean and spread over the pixels `take` keeps (index into `rgba`, alpha over 0.9). */
function colourStats(rgba, take) {
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < rgba.length / 4; i += 1) {
    if (!take(i) || rgba[i * 4 + 3] < 0.9) continue;
    for (let c = 0; c < 3; c += 1) {
      sums[c] += rgba[i * 4 + c];
      squares[c] += rgba[i * 4 + c] ** 2;
    }
    n += 1;
  }
  if (n === 0) throw new Error('no skin to match his chest to');
  return sums.map((s, c) => ({ mean: s / n, spread: Math.sqrt(Math.max(1e-6, squares[c] / n - (s / n) ** 2)) }));
}

/**
 * The portrait as it shows, `FINE` times over: the art (`picture`, cut out, with its
 * `framing`) scaled to his head's lines, over his chest drawn by `drawChest`.
 */
function shownPortrait(picture, framing, drawChest) {
  const width = SHOWN_WIDTH * FINE;
  const height = PORTRAIT_HEIGHT * FINE;
  const scale = (HEAD_LINES * FINE) / (framing.chin - framing.crown);
  const left = width / 2 - framing.neck[0] * scale;
  const top = CROWN_LINE * FINE - framing.crown * scale;
  const across = Math.round(picture.width * scale);
  const down = Math.round(picture.height * scale);
  const art = resample(picture, { x: 0, y: 0, w: picture.width, h: picture.height }, across, down);
  const neck = [width / 2, top + framing.neck[1] * scale];
  const chest = Float64Array.from(drawChest({ width, height, crown: CROWN_LINE * FINE, neck }), (v, i) => (i % 4 === 3 ? v / 255 : v));

  /* His chest coloured as the art's skin between his chin and its last rows. */
  const x0 = Math.round(left);
  const y0 = Math.round(top);
  const below = Math.round((framing.chin - framing.crown) * scale) + y0;
  const artSkin = colourStats(art, (i) => Math.floor(i / across) + y0 > below);
  const chestSkin = colourStats(chest, (i) => Math.floor(i / width) > y0 + down);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < 3; c += 1) chest[i * 4 + c] = ((chest[i * 4 + c] - chestSkin[c].mean) / chestSkin[c].spread) * artSkin[c].spread + artSkin[c].mean;
  }

  /* His chest only below the art's outline (each column's first solid row), so it carries the art down and never stands out of it. */
  const outline = new Int32Array(width).fill(height);
  for (let x = 0; x < width; x += 1) {
    const ax = Math.min(across - 1, Math.max(0, x - x0));
    for (let ay = 0; ay < down; ay += 1) {
      if (art[(ay * across + ax) * 4 + 3] > 0.5) {
        outline[x] = ay + y0;
        break;
      }
    }
  }

  /* The art over it, fading out above its last rows (and at its sides, where it is narrower than the portrait), its cut hair fading in. */
  const out = new Float64Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const ax = x - x0;
      const ay = y - y0;
      let a = 0;
      let colour = [0, 0, 0];
      if (ax >= 0 && ax < across && ay >= 0 && ay < down) {
        const p = (ay * across + ax) * 4;
        a = art[p + 3];
        a *= Math.min(1, (down - ay) / (CHEST_FADE * FINE));
        if (framing.crown < 0) a *= Math.min(1, (ay + 0.5) / (HAIR_FADE * FINE));
        if (x0 > 0) a *= Math.min(1, (ax + 0.5) / (CHEST_FADE * FINE));
        if (x0 + across < width) a *= Math.min(1, (across - ax - 0.5) / (CHEST_FADE * FINE));
        colour = [art[p], art[p + 1], art[p + 2]];
      }
      const b = y < outline[x] ? 0 : chest[o + 3];
      const covered = a + b * (1 - a);
      for (let c = 0; c < 3; c += 1) out[o + c] = covered > 0 ? (colour[c] * a + chest[o + c] * b * (1 - a)) / covered : 0;
      out[o + 3] = covered * 255;
    }
  }
  return { width, height, rgba: out };
}

/** His select and versus portrait, Tekken 3's TIM. */
function portrait(shown) {
  const width = PORTRAIT_WIDTH;
  const height = PORTRAIT_HEIGHT;
  const image = resample(shown, { x: 0, y: 0, w: shown.width, h: shown.height }, width, height);
  const indices = new Uint8Array(width * height);
  const palette = new Array(256).fill(0);
  for (let band = 0; band < 4; band += 1) {
    const pixels = [];
    const where = [];
    for (let y = band * 64; y < Math.min(height, band * 64 + 64); y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        const a = image[o + 3];
        if (a < threshold(x, y) || a < 0.25) continue;
        pixels.push([image[o], image[o + 1], image[o + 2]].map((v) => Math.max(0, Math.min(255, v))));
        where.push(y * width + x);
      }
    }
    const { centres, nearest } = quantize(pixels, 63);
    centres.forEach((c, k) => (palette[band * 64 + 1 + k] = toPlayStation(c)));
    where.forEach((at, i) => (indices[at] = 1 + nearest[i]));
  }
  return tim8(palette, indices, width, height);
}

/**
 * A grid icon, `width` by `height`: the rows of his head from `from` to `to` (in head heights from the
 * top of his hair, `framing`'s), centred on his neck, over his gradient.
 */
function icon(picture, framing, width, height, from, to) {
  const head = framing.chin - framing.crown;
  const crop = { w: 0, h: head * (to - from), x: 0, y: framing.crown + head * from };
  crop.w = (crop.h * width * PIXEL_ASPECT) / height;
  crop.x = framing.neck[0] - crop.w / 2;
  const image = resample(picture, crop, width, height);
  const colours = [];
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const behind = [20 + 120 * t, 6 + 6 * t, 8 + 10 * t];
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const a = image[o + 3];
      colours.push([0, 1, 2].map((k) => image[o + k] * a + behind[k] * (1 - a)));
    }
  }
  const { centres, nearest } = quantize(colours, ICON_COLOURS);
  const palette = new Array(256).fill(0);
  centres.forEach((c, k) => (palette[k] = toPlayStation(c)));
  return tim8(palette, Uint8Array.from(nearest), width, height);
}

/** A name picture (`kazuya-name.mjs`'s width and values) as a 4-bit TIM the sheet's size, no palette. */
function sheetName(name) {
  if (name.width > NAME_WIDTH) throw new Error(`a name of ${name.width} pixels is wider than the sheet's ${NAME_WIDTH}`);
  const bytes = new Uint8Array(8 + 12 + (NAME_WIDTH / 2) * NAME_HEIGHT);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x10, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, 12 + (NAME_WIDTH / 2) * NAME_HEIGHT, true);
  view.setUint16(16, NAME_WIDTH / 4, true);
  view.setUint16(18, NAME_HEIGHT, true);
  for (let y = 0; y < NAME_HEIGHT; y += 1) {
    for (let x = 0; x < name.width; x += 1) bytes[20 + y * (NAME_WIDTH / 2) + (x >> 1)] |= name.pixels[y * name.width + x] << ((x & 1) * 4);
  }
  return bytes;
}

/**
 * His select portrait (also the versus screen's), two grid icons and sheet name, from Tekken 4's
 * render of him (`render`, decoded, when there is one) or its select pictures (file 118), his chest
 * as `drawChest` draws it (`kazuya-art.mjs`: `{ width, height, crown, neck }` to RGBA) and his name
 * picture.
 */
export function kazuyaSelectArt({ render, portraits, drawChest, name }) {
  const [picture, framing] = render ? [matteOnGradient(render), RENDER_FRAMING] : [readTim2Pictures(portraits)[KAZUYA], SELECT_FRAMING];
  return {
    portrait: portrait(shownPortrait(picture, framing, drawChest)),
    bigIcon: icon(picture, framing, 32, 68, -0.02, 1.12),
    smallIcon: icon(picture, framing, 32, 58, 0.1, 1.03),
    name: sheetName(name),
  };
}

/** The four, back to back: portrait, single row's icon, double rows' icon, name. */
export function kazuyaArt(sources) {
  const art = kazuyaSelectArt(sources);
  const parts = [art.portrait, art.bigIcon, art.smallIcon, art.name];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
