/**
 * The original pictures the remake shows as they are (`pictures/*.png`), cut from the textures the
 * overlays upload (texture archives: a count, then each packed TIM's offset and size) as the game
 * draws them, each enlarged `PICTURE_SCALE` times by edge-directed interpolation
 * (`scripts/lib/upscale.mjs`). Black is transparent.
 *
 * - From the title overlay (BNS 10, loaded at `0x800b8d58`; its archive at `0x800ebfa4`): the
 *   title's picture, the TEKKEN 3 logo over its red kanji, six cuts of 8-bit texels each through
 *   its own palette (`0x7ea0` on, a row apart), 368 × 480; and the namco mark under it, 72 × 16
 *   4-bit texels at VRAM word 800 through the palette at `0x7820`.
 * - From the character select's overlay (BNS 9, at the same place; its archive where its state
 *   later lies, `0x80118628`, with the boot's textures from the title overlay's `0x800ba088`
 *   under it): each character's big icon (`0x800b8da8`, 32 × 68) and small one (`0x8002152c` in
 *   the executable, 32 × 58, two of them in pieces), and the portraits (`0x800b912c`, a packed
 *   archive of 8-bit TIMs 126 × 252 whose palette moves on 64 colours every 64 lines). Kazuya's
 *   portrait and icons come from his art file when it is built. The select's frame, title and
 *   pattern are drawn new.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { decompress } from '../lib/lz.mjs';
import { encodePng } from '../lib/png.mjs';
import { readTimChain } from '../lib/texture.mjs';
import { upscale } from '../lib/upscale.mjs';
import { PICTURE_SCALE } from '../../src/assets/manifest.ts';

const OVERLAY = 0x800b8d58;
const SCREEN = { w: 0x170, h: 0x1e0 };
const TITLE_ARCHIVE = 0x800ebfa4;
const BOOT_ARCHIVE = 0x800ba088;
const SELECT_ARCHIVE = 0x80118628;
const PORTRAITS = 0x800b912c;
const TITLE_CUTS = [
  [0, 0, 0x80, 0x100, 0x200, 0],
  [0x80, 0, 0x80, 0x100, 0x240, 0],
  [0x100, 0, 0x70, 0x100, 0x280, 0],
  [0, 0x100, 0x80, 0xe0, 0x200, 0x100],
  [0x80, 0x100, 0x80, 0xe0, 0x240, 0x100],
  [0x100, 0x100, 0x70, 0xe0, 0x280, 0x100],
];
const TITLE_PALETTE = 0x7ea0;
const MARK = { w: 0x48, h: 0x10, source: 800, clut: 0x7820 };
const BIG_ICONS = 0x800b8da8;
const SMALL_ICONS = 0x8002152c;
const ICON = { w: 0x20, big: 0x44, small: 0x3a };
const PORTRAIT = { w: 126, h: 252, band: 64, columns: 8 };
const ROSTER = 22;
/** True Ogre's small icon, and the empty one, are drawn in three pieces. */
const TRUE_OGRE = 0x14;
const EMPTY_ICON = 0x17;
const KAZUYA_ART = 'public/data/fighters/52.art';

const five = (v) => (v << 3) | (v >> 2);

/** A VRAM with archives' TIMs placed where they say. */
function createVram() {
  const words = new Uint16Array(1024 * 512);
  const place = (rect) => {
    for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) words[((rect.y + y) & 511) * 1024 + ((rect.x + x) & 1023)] = rect.data[y * rect.w + x] ?? 0;
  };
  return {
    words,
    archive(bytes, at) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint32(at, true);
      for (let i = 0; i < count; i += 1) {
        for (const tim of readTimChain(decompress(bytes, at + view.getUint32(at + 4 + i * 8, true)))) {
          if (tim.image) place(tim.image);
          if (tim.clut) place(tim.clut);
        }
      }
    },
    /** A texel's colour through a page (its depth in bits 7 and 8) and palette. */
    texel(page, u, v, clut) {
      const [tx, ty, depth] = [(page & 0xf) * 64, ((page >> 4) & 1) * 256, (page >> 7) & 3];
      const [cx, cy] = [(clut & 0x3f) * 16, clut >> 6];
      const row = (ty + (v & 0xff)) * 1024 + tx;
      if (depth === 0) return words[cy * 1024 + cx + ((words[row + ((u & 0xff) >> 2)] >> ((u & 3) * 4)) & 15)];
      if (depth === 1) return words[cy * 1024 + cx + ((words[row + ((u & 0xff) >> 1)] >> ((u & 1) * 8)) & 255)];
      return words[row + (u & 0xff)];
    },
  };
}

/** An RGBA canvas; colours plotted unless transparent. */
function createPicture(w, h) {
  const pixels = new Uint8Array(w * h * 4);
  return {
    w,
    h,
    pixels,
    plot(x, y, colour) {
      if (colour === 0 || x < 0 || y < 0 || x >= w || y >= h) return;
      pixels.set([five(colour & 31), five((colour >> 5) & 31), five((colour >> 10) & 31), 255], (y * w + x) * 4);
    },
    png: () => {
      const big = upscale(pixels, w, h, PICTURE_SCALE);
      return encodePng(big.w, big.h, big.pixels);
    },
  };
}

/** A picture in VRAM drawn at (x, y): `source` its left edge in VRAM words, `top` its first line, `mode` its depth (bits 7 and 8). */
function drawImage(vram, picture, x, y, w, h, source, top, clut, mode) {
  const depth = (mode & 0x180) >> 7;
  for (let j = 0; j < h; j += 1) {
    const line = top + j;
    const page = (depth << 7) | (((line >> 8) & 1) << 4) | ((source >> 6) & 0xf);
    for (let i = 0; i < w; i += 1) picture.plot(x + i, y + j, vram.texel(page, ((source & 0x3f) << (2 - depth)) + i, line, clut));
  }
}

/** A sprite's texels (`uv` its place and palette, `page` its page) at (x, y). */
function drawSprite(vram, picture, x, y, w, h, uv, page) {
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) picture.plot(x + i, y + j, vram.texel(page, (uv & 0xff) + i, ((uv >> 8) & 0xff) + j, uv >>> 16));
}

/** A portrait TIM through its banded palette into a sheet's cell. */
function drawPortrait(sheet, tim, cell) {
  const [left, top] = [(cell % PORTRAIT.columns) * 128, Math.floor(cell / PORTRAIT.columns) * 256];
  for (let y = 0; y < tim.image.h; y += 1) {
    for (let x = 0; x < tim.image.w * 2; x += 1) {
      const index = (tim.image.data[y * tim.image.w + (x >> 1)] >> ((x & 1) * 8)) & 0xff;
      sheet.plot(left + x, top + y, tim.clut.data[(Math.floor(y / PORTRAIT.band) * PORTRAIT.band + index) & 0xff]);
    }
  }
}

/** An 8-bit TIM through its palette at (x, y). */
function drawTim(sheet, tim, x0, y0) {
  for (let y = 0; y < tim.image.h; y += 1) for (let x = 0; x < tim.image.w * 2; x += 1) sheet.plot(x0 + x, y0 + y, tim.clut.data[(tim.image.data[y * tim.image.w + (x >> 1)] >> ((x & 1) * 8)) & 0xff]);
}

function titlePictures(title) {
  const vram = createVram();
  vram.archive(title, TITLE_ARCHIVE - OVERLAY);
  const picture = createPicture(SCREEN.w, SCREEN.h);
  TITLE_CUTS.forEach(([x, y, w, h, source, top], i) => drawImage(vram, picture, x, y, w, h, source, top, TITLE_PALETTE + i * 0x40, 0x80));
  const mark = createPicture(MARK.w, MARK.h);
  drawImage(vram, mark, 0, 0, MARK.w, MARK.h, MARK.source, 0, MARK.clut, 0);
  return { title: picture.png(), namco: mark.png() };
}

function selectPictures(exe, title, select, kazuya) {
  const vram = createVram();
  vram.archive(title, BOOT_ARCHIVE - OVERLAY);
  vram.archive(select, SELECT_ARCHIVE - OVERLAY);
  const view = new DataView(select.buffer, select.byteOffset, select.byteLength);
  const at = (address) => address - OVERLAY;
  const out = {};
  const count = ROSTER + 1;
  const big = createPicture(ICON.w * count, ICON.big);
  const small = createPicture(ICON.w * (count + 1), ICON.small);
  for (let roster = 0; roster < ROSTER; roster += 1) {
    drawSprite(vram, big, roster * ICON.w, 0, ICON.w, ICON.big, view.getUint32(at(BIG_ICONS) + roster * 8, true), view.getUint16(at(BIG_ICONS) + roster * 8 + 4, true));
  }
  for (const index of [...Array(ROSTER).keys(), EMPTY_ICON]) {
    const uv = exe.u32(SMALL_ICONS + index * 8);
    const page = exe.u16(SMALL_ICONS + index * 8 + 4);
    const x = (index === EMPTY_ICON ? count : index) * ICON.w;
    if (index === TRUE_OGRE) {
      drawSprite(vram, small, x, 0, ICON.w, 0x18, uv, page);
      drawSprite(vram, small, x, 0x18, ICON.w, 0x18, uv + 0x20, page);
      drawSprite(vram, small, x, 0x30, ICON.w, 0xa, uv + 0x40, page);
    } else if (index === EMPTY_ICON) {
      drawSprite(vram, small, x, 0, ICON.w, 0xa, uv, page);
      drawSprite(vram, small, x, 0xa, ICON.w, 0x18, ((uv & 0xffff00ff) + 0x20) >>> 0, page);
      drawSprite(vram, small, x, 0x22, ICON.w, 0x18, ((uv & 0xffff00ff) + 0x40) >>> 0, page);
    } else drawSprite(vram, small, x, 0, ICON.w, ICON.small, uv, page);
  }
  const portraits = createPicture(128 * PORTRAIT.columns, 256 * Math.ceil(count / PORTRAIT.columns));
  const packed = at(PORTRAITS);
  for (let n = 0; n < view.getUint32(packed, true); n += 1) drawPortrait(portraits, readTimChain(decompress(select, packed + view.getUint32(packed + 4 + n * 8, true)))[0], n);
  if (kazuya !== null) {
    const [portrait, bigIcon, smallIcon] = readTimChain(kazuya);
    drawPortrait(portraits, portrait, ROSTER);
    drawTim(big, bigIcon, ROSTER * ICON.w, 0);
    drawTim(small, smallIcon, ROSTER * ICON.w, 0);
  }
  out['select-icons-big'] = big.png();
  out['select-icons-small'] = small.png();
  out.portraits = portraits.png();
  return out;
}

/** Each picture as a PNG, by name. */
export function originalPictures(exe, root) {
  const bytes = (file) => new Uint8Array(readFileSync(path.join(root, file)));
  const title = bytes('public/data/bns/010.bin');
  const kazuya = existsSync(path.join(root, KAZUYA_ART)) ? bytes(KAZUYA_ART) : null;
  const theater = bytes('public/data/bns/301.bin');
  return { ...titlePictures(title), ...selectPictures(exe, title, bytes('public/data/bns/009.bin'), kazuya), captions: captionPictures(theater), 'credits-mark': creditsMark(theater) };
}

/** The namco mark the credits end on (a 4-bit TIM in the Theater's overlay at 0x80111d30, 260 by 45), palette index 0 clear. */
const CREDITS_MARK = 0x80111d30;
function creditsMark(theater) {
  const [tim] = readTimChain(theater.subarray(CREDITS_MARK - 0x800b8d58));
  const { image, clut } = tim;
  const w = image.w * 4;
  const picture = createPicture(w, image.h);
  for (let y = 0; y < image.h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = (image.data[y * image.w + (x >> 2)] >> ((x & 3) * 4)) & 0xf;
      if (index !== 0) picture.plot(x, y, clut.data[index]);
    }
  }
  return picture.png();
}

/*
 * The endings' captions (the Theater's overlay, BNS 301, at 0x800b8d58): nine records of 20 bytes
 * from 0x800b96d8 (the picture's offset from 0x800bcad8, its place on the frame, its width and
 * height, its palette), each picture 4 bits a texel, 128 bytes a line. The player lays a caption
 * into the decoded frame through its palette (0x800b9804, 0x800b9884 and 0x800b9904 for palettes
 * 0, 2 and 3; 8 bytes an entry: its colour and its way): texel 0 leaves the frame, a way of 0 puts
 * the colour, any other mixes a quarter of the frame with half the colour, which is the colour at
 * two thirds over the frame at three quarters.
 */
const THEATER = 0x800b8d58;
const CAPTION_RECORDS = 0x800b96d8;
const CAPTION_PICTURES = 0x800bcad8;
const CAPTION_PALETTES = { 0: 0x800b9804, 2: 0x800b9884, 3: 0x800b9904 };
export const CAPTION_COUNT = 9;

/** The captions as one picture, each under the one before, at their own size (then enlarged). */
function captionPictures(theater) {
  const view = new DataView(theater.buffer, theater.byteOffset, theater.byteLength);
  const at = (address) => address - THEATER;
  const records = Array.from({ length: CAPTION_COUNT }, (_, i) => {
    const r = at(CAPTION_RECORDS) + i * 20;
    return { offset: view.getUint32(r, true), width: view.getUint16(r + 10, true), height: view.getUint16(r + 12, true), palette: view.getUint16(r + 16, true) };
  });
  const w = Math.max(...records.map((r) => r.width));
  const h = records.reduce((n, r) => n + r.height, 0);
  const pixels = new Uint8Array(w * h * 4);
  let top = 0;
  for (const r of records) {
    const palette = at(CAPTION_PALETTES[r.palette]);
    for (let y = 0; y < r.height; y += 1) {
      for (let x = 0; x < r.width; x += 1) {
        const byte = theater[at(CAPTION_PICTURES) + r.offset + y * 128 + (x >> 1)];
        const index = (x & 1) === 0 ? byte & 0xf : byte >> 4;
        if (index === 0) continue;
        const entry = palette + index * 8;
        const colour = [theater[entry], theater[entry + 1], theater[entry + 2]];
        const replaces = theater[entry + 3] === 0;
        const o = ((top + y) * w + x) * 4;
        if (replaces) pixels.set([...colour, 255], o);
        else pixels.set([...colour.map((c) => Math.round((c * 2) / 3)), 191], o);
      }
    }
    top += r.height;
  }
  const big = upscale(pixels, w, h, PICTURE_SCALE);
  return encodePng(big.w, big.h, big.pixels);
}
