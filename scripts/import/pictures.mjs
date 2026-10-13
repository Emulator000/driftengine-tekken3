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
 * - The Options' (the same overlay): the title's picture through their own palettes (`0x7d20` on),
 *   blue; the pad's two pictures (the archive at `0x800d4d68`: the DualShock's, then the standard
 *   pad's, 144 × 136 each, 8-bit); the modes' labels (`0x800eae90`, 96 × 14 each, in their colours,
 *   then greyed through `0x7e5e`); the key configuration's step arrows (20 × 16, through the small
 *   font's palettes for colours 5, 6, 10, 7 and 11); and the four buttons (`0x800b92a4`, 12 × 20 each).
 * - From the character select's overlay (BNS 9, at the same place; its archive where its state
 *   later lies, `0x80118628`, with the boot's textures from the title overlay's `0x800ba088`
 *   under it): each character's big icon (`0x800b8da8`, 32 × 68) and small one (`0x8002152c` in
 *   the executable, 32 × 58, two of them in pieces), and the portraits (`0x800b912c`, a packed
 *   archive of 8-bit TIMs 126 × 252 whose palette moves on 64 colours every 64 lines). Kazuya's
 *   portrait and icons come from his art file when it is built. The select's frame, title and
 *   pattern are drawn new.
 * - From the results' overlay (BNS 302, at the same place): the backdrops of Time Attack's results
 *   (its archive at `0x800b9394`) and Tekken Force's (`0x800d8400`), each cut and drawn as the
 *   title's picture is, 368 × 480.
 * - From Tekken Ball's stage file (BNS 55): the beach's panorama (1024 × 256, its 32 × 32 cells as
 *   its map lays them, texel 0 clear).
 * - From Tekken Force's stage files (BNS 51 to 54): each stage's backdrop (its 64 × 64 cells as its
 *   map lays them), and from the first the +LIFE item (64 × 128 at VRAM (512, 64) through the
 *   palette at `0x7801`) and its glow (64 × 64 at (512, 0) through `0x7800`); from Tekken Force's
 *   overlay (BNS 7, at `0x800b0548`) the three keys (`0x800b0afc`, an archive of 4-bit TIMs 20 × 36),
 *   side by side.
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
/** True Ogre's small icon, and the two question marks (no choice's orange one, a taken or unearned cell's blue one), are drawn in three pieces. */
const TRUE_OGRE = 0x14;
const NO_CHOICE_ICON = 0x16;
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
    /** TIMs as they are, each placed. */
    load(tims) {
      for (const tim of tims) {
        if (tim.image) place(tim.image);
        if (tim.clut) place(tim.clut);
      }
    },
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

/** A 4-bit TIM through its first palette at (x, y). */
function drawTim4(sheet, tim, x0, y0) {
  for (let y = 0; y < tim.image.h; y += 1) for (let x = 0; x < tim.image.w * 4; x += 1) sheet.plot(x0 + x, y0 + y, tim.clut.data[(tim.image.data[y * tim.image.w + (x >> 2)] >> ((x & 3) * 4)) & 0xf]);
}

/** A full-screen picture of six 8-bit cuts, each through its own palette (from `palette` on, a row apart), from an archive. */
function screenPicture(bytes, archive, palette = TITLE_PALETTE) {
  const vram = createVram();
  vram.archive(bytes, archive - OVERLAY);
  const picture = createPicture(SCREEN.w, SCREEN.h);
  TITLE_CUTS.forEach(([x, y, w, h, source, top], i) => drawImage(vram, picture, x, y, w, h, source, top, palette + i * 0x40, 0x80));
  return picture;
}

/**
 * The Theater's menu's (its overlay, BNS 301): its archive (`0x801143d8`) drawn through its
 * thumbnails' records (`0x800b9984`, 12 bytes: palette x and y, picture x and y), 61 thumbnails of
 * 48 × 64 and the film frame over them, eight to a row; and of its eight pictures (`0x8010e204`,
 * plain TIMs) the Tekken 3 cover strip, its caption and the disc.
 */
const THEATER_ARCHIVE = 0x801143d8;
const THUMB_RECORDS = 0x800b9984;
const THUMB = { w: 0x30, h: 0x40, count: 61, columns: 8, film: { uv: (0x7f60 << 16) | (0x40 << 8) | 0x60, page: 0x1a } };
const THEATER_PICTURES = 0x8010e204;
const THEATER_PICTURE = { cover: 4, caption: 5, disc: 7 };

function theaterPictures(theater) {
  const vram = createVram();
  vram.archive(theater, THEATER_ARCHIVE - OVERLAY);
  const view = new DataView(theater.buffer, theater.byteOffset, theater.byteLength);
  const sheet = createPicture(THUMB.w * THUMB.columns, THUMB.h * Math.ceil((THUMB.count + 1) / THUMB.columns));
  for (let i = 0; i <= THUMB.count; i += 1) {
    const [x, y] = [(i % THUMB.columns) * THUMB.w, Math.floor(i / THUMB.columns) * THUMB.h];
    if (i === THUMB.count) {
      drawSprite(vram, sheet, x, y, THUMB.w, THUMB.h, THUMB.film.uv >>> 0, THUMB.film.page);
      continue;
    }
    const [cx, cy, ix, iy] = [0, 2, 4, 6].map((o) => view.getUint16(THUMB_RECORDS - OVERLAY + i * 12 + o, true));
    const uv = ((ix & 0x7f) << 1) | ((iy & 0xff) << 8) | (((cy << 6) | ((cx >> 4) & 0x3f)) << 16);
    drawSprite(vram, sheet, x, y, THUMB.w, THUMB.h, uv >>> 0, 0x80 | ((iy & 0x100) >> 4) | ((ix & 0x380) >> 6));
  }
  const tim = (n) => readTimChain(theater.subarray(view.getUint32(THEATER_PICTURES - OVERLAY + n * 4, true) - OVERLAY))[0];
  const single = (n) => {
    const t = tim(n);
    const depth = t.bpp === 4 ? 4 : 2;
    const picture = createPicture(t.image.w * depth, t.image.h);
    if (t.bpp === 4) drawTim4(picture, t, 0, 0);
    else drawTim(picture, t, 0, 0);
    return picture.png();
  };
  return {
    'theater-thumbs': sheet.png(),
    'theater-cover': single(THEATER_PICTURE.cover),
    'theater-caption': single(THEATER_PICTURE.caption),
    'theater-disc': single(THEATER_PICTURE.disc),
  };
}

/** The Options' pictures: their palettes for the title's picture, the archive of the pad's two pictures, the modes' labels, the step arrows and the buttons. */
const OPTIONS_PALETTE = 0x7d20;
const OPTIONS_PADS = 0x800d4d68;
const PAD = { w: 0x90, h: 0x88, source: 0x180, standard: 0x7ca0, dualShock: 0x7ce0 };
const OPTIONS_LABELS = 0x800eae90;
const LABEL = { w: 0x60, h: 0xe, grey: 0x7e5e, page: 0xb };
const ARROWS = { w: 0x14, h: 0x10, u: 0x80, colours: [5, 6, 10, 7, 11], font: 0x7e10 };
const BUTTONS = [0x800b92a4, 0x800b92a8, 0x800b92ac, 0x800b92b0];
const BUTTON = { w: 0xc, h: 0x14, page: 0x1f };

function optionsPictures(title) {
  const vram = createVram();
  vram.archive(title, BOOT_ARCHIVE - OVERLAY);
  vram.archive(title, TITLE_ARCHIVE - OVERLAY);
  vram.archive(title, OPTIONS_PADS - OVERLAY);
  const view = new DataView(title.buffer, title.byteOffset, title.byteLength);
  const pads = createPicture(PAD.w * 2, PAD.h);
  drawImage(vram, pads, 0, 0, PAD.w, PAD.h, PAD.source, 0x100, PAD.dualShock, 0x80);
  drawImage(vram, pads, PAD.w, 0, PAD.w, PAD.h, PAD.source, 0, PAD.standard, 0x80);
  const labels = createPicture(LABEL.w * 2, LABEL.h * 8);
  for (let i = 0; i < 8; i += 1) {
    const word = view.getUint32(OPTIONS_LABELS - OVERLAY + i * 8 + 4, true);
    drawSprite(vram, labels, 0, i * LABEL.h, LABEL.w, LABEL.h, word, LABEL.page);
    drawSprite(vram, labels, LABEL.w, i * LABEL.h, LABEL.w, LABEL.h, ((word & 0xffff) | (LABEL.grey << 16)) >>> 0, LABEL.page);
  }
  const arrows = createPicture(ARROWS.w, ARROWS.h * ARROWS.colours.length);
  ARROWS.colours.forEach((colour, row) => drawSprite(vram, arrows, 0, row * ARROWS.h, ARROWS.w, ARROWS.h, (((ARROWS.font | colour) << 16) | ARROWS.u) >>> 0, LABEL.page));
  const buttons = createPicture(BUTTON.w * BUTTONS.length, BUTTON.h);
  BUTTONS.forEach((address, i) => drawSprite(vram, buttons, i * BUTTON.w, 0, BUTTON.w, BUTTON.h, view.getUint32(address - OVERLAY, true), BUTTON.page));
  return {
    options: screenPicture(title, TITLE_ARCHIVE, OPTIONS_PALETTE).png(),
    'options-pads': pads.png(),
    'options-labels': labels.png(),
    'options-arrows': arrows.png(),
    'options-buttons': buttons.png(),
  };
}

const RESULTS_ARCHIVES = { results: 0x800b9394, 'force-results': 0x800d8400 };

function resultsPictures(results) {
  return Object.fromEntries(Object.entries(RESULTS_ARCHIVES).map(([name, archive]) => [name, screenPicture(results, archive).png()]));
}

function titlePictures(title) {
  const vram = createVram();
  vram.archive(title, TITLE_ARCHIVE - OVERLAY);
  const picture = screenPicture(title, TITLE_ARCHIVE);
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
  const small = createPicture(ICON.w * (count + 2), ICON.small);
  for (let roster = 0; roster < ROSTER; roster += 1) {
    drawSprite(vram, big, roster * ICON.w, 0, ICON.w, ICON.big, view.getUint32(at(BIG_ICONS) + roster * 8, true), view.getUint16(at(BIG_ICONS) + roster * 8 + 4, true));
  }
  for (const index of [...Array(ROSTER).keys(), EMPTY_ICON, NO_CHOICE_ICON]) {
    const uv = exe.u32(SMALL_ICONS + index * 8);
    const page = exe.u16(SMALL_ICONS + index * 8 + 4);
    const x = (index === EMPTY_ICON ? count : index === NO_CHOICE_ICON ? count + 1 : index) * ICON.w;
    if (index === TRUE_OGRE) {
      drawSprite(vram, small, x, 0, ICON.w, 0x18, uv, page);
      drawSprite(vram, small, x, 0x18, ICON.w, 0x18, uv + 0x20, page);
      drawSprite(vram, small, x, 0x30, ICON.w, 0xa, uv + 0x40, page);
    } else if (index === EMPTY_ICON || index === NO_CHOICE_ICON) {
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
  return {
    ...titlePictures(title),
    ...optionsPictures(title),
    ...selectPictures(exe, title, bytes('public/data/bns/009.bin'), kazuya),
    ...resultsPictures(bytes('public/data/bns/302.bin')),
    captions: captionPictures(theater),
    ...theaterPictures(theater),
    'credits-mark': creditsMark(theater),
    ...ballPictures(bytes('public/data/bns/055.bin')),
    ...forcePictures([51, 52, 53, 54].map((n) => bytes(`public/data/bns/0${n}.bin`)), bytes('public/data/bns/007.bin')),
  };
}

/** An archive's members: a count, then each member's offset and size. */
function members(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint32(0, true) }, (_, i) => bytes.subarray(view.getUint32(4 + i * 8, true), view.getUint32(4 + i * 8, true) + view.getUint32(8 + i * 8, true)));
}

const TILE = 0x20;

/**
 * Tekken Ball's beach (BNS 55, an archive: its textures an archive of TIMs, then the ground's map,
 * then the panorama's): the panorama laid out whole, each cell's texture word naming its page
 * (bits 8 to 12) and its 32-texel cell in it (bits 0 to 5), its palette word beside it.
 */
function ballPictures(beach) {
  const [textures, , map] = members(beach);
  const vram = createVram();
  vram.load(members(textures).flatMap((tim) => readTimChain(tim)));
  const view = new DataView(map.buffer, map.byteOffset, map.byteLength);
  const [width, height] = [view.getUint16(0, true), view.getUint16(2, true)];
  const panorama = createPicture(width * TILE, height * TILE);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const cell = row * width + column;
      const tile = view.getUint16(4 + cell * 2, true);
      const clut = view.getUint16(4 + (width * height + cell) * 2, true);
      const uv = ((clut << 16) | ((((tile >> 3) & 7) * TILE) << 8) | ((tile & 7) * TILE)) >>> 0;
      drawSprite(vram, panorama, column * TILE, row * TILE, TILE, TILE, uv, (tile >> 8) & 0x1f);
    }
  }
  return { 'ball-backdrop': panorama.png() };
}

const FORCE_TILE = 0x40;
const FORCE_ITEM = { page: 8, uv: 0x4000, clut: 0x7801, w: 0x40, h: 0x80 };
const FORCE_GLOW = { page: 8, uv: 0, clut: 0x7800, w: 0x40, h: 0x40 };
const FORCE_OVERLAY = 0x800b0548;
const FORCE_KEYS = 0x800b0afc;

/**
 * Tekken Force's stages (archives: their textures an archive of TIMs, then the ground's map, then
 * the backdrop's, then the script): each backdrop laid out whole, each cell's texture word naming
 * its page (bits 8 to 12) and its 64-texel cell in it (bits 0 to 3), its palette word beside it;
 * the +LIFE item and its glow; and the keys from the mode's overlay.
 */
function forcePictures(stages, overlay) {
  const out = {};
  stages.forEach((bytes, k) => {
    const [textures, , map] = members(bytes);
    const vram = createVram();
    vram.load(members(textures).flatMap((tim) => readTimChain(tim)));
    const view = new DataView(map.buffer, map.byteOffset, map.byteLength);
    const [width, height] = [view.getUint16(0, true), view.getUint16(2, true)];
    const backdrop = createPicture(width * FORCE_TILE, height * FORCE_TILE);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const cell = row * width + column;
        const tile = view.getUint16(4 + cell * 2, true);
        const clut = view.getUint16(4 + (width * height + cell) * 2, true);
        const uv = ((clut << 16) | ((((tile >> 2) & 3) * FORCE_TILE) << 8) | ((tile & 3) * FORCE_TILE)) >>> 0;
        drawSprite(vram, backdrop, column * FORCE_TILE, row * FORCE_TILE, FORCE_TILE, FORCE_TILE, uv, (tile >> 8) & 0x1f);
      }
    }
    out[`force-backdrop-${15 + k}`] = backdrop.png();
    if (k !== 0) return;
    for (const [name, { page, uv, clut, w, h }] of [['force-item', FORCE_ITEM], ['force-glow', FORCE_GLOW]]) {
      const picture = createPicture(w, h);
      drawSprite(vram, picture, 0, 0, w, h, ((clut << 16) | uv) >>> 0, page);
      out[name] = picture.png();
    }
  });
  const keys = members(overlay.subarray(FORCE_KEYS - FORCE_OVERLAY)).map((tim) => readTimChain(tim)[0]);
  const sheet = createPicture(keys.reduce((w, tim) => w + tim.image.w * 4, 0), Math.max(...keys.map((tim) => tim.image.h)));
  let x = 0;
  for (const tim of keys) {
    drawTim4(sheet, tim, x, 0);
    x += tim.image.w * 4;
  }
  out['force-keys'] = sheet.png();
  return out;
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
