/**
 * PlayStation textures: TIM images placed in a VRAM, and the texels a polygon sees through its
 * texture page and palette.
 *
 * A fighter's TIMs carry VRAM coordinates relative to its slot; polygons address the same space
 * relative to texture page 6 and palette row 504. Both are kept relative here.
 */

const VRAM_W = 1024;
const VRAM_H = 512;

/** `count` little-endian 16-bit words from `at`, copied out of the buffer. */
function words(view, at, count) {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getUint16(at + i * 2, true);
  return out;
}

/**
 * Every TIM in a buffer of TIMs laid end to end. Stops at the first thing that is not one. A TIM
 * whose image block holds no more than its own length word is a palette-only one, as the game reads
 * it (it uploads the image from past the TIM, whatever lies there, which this leaves out): its
 * image is null.
 */
export function readTimChain(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tims = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    if (view.getUint32(at, true) !== 0x10) break;
    const flags = view.getUint32(at + 4, true);
    if (flags & ~0xb) break;
    let p = at + 8;
    let clut = null;
    /* A block shorter than its own header, or running past the buffer, ends the chain. */
    const sane = (length) => length >= 12 && p + length <= bytes.length;
    if (flags & 8) {
      const length = view.getUint32(p, true);
      if (!sane(length)) break;
      clut = {
        x: view.getUint16(p + 4, true),
        y: view.getUint16(p + 6, true),
        w: view.getUint16(p + 8, true),
        h: view.getUint16(p + 10, true),
        data: words(view, p + 12, (length - 12) / 2),
      };
      p += length;
    }
    const length = view.getUint32(p, true);
    if (length <= 12) {
      if (clut === null || length < 4) break;
      tims.push({ bpp: [4, 8, 16, 24][flags & 3], clut, image: null });
      at = p + (length & ~3);
      continue;
    }
    if (!sane(length)) break;
    const image = {
      x: view.getUint16(p + 4, true),
      y: view.getUint16(p + 6, true),
      w: view.getUint16(p + 8, true),
      h: view.getUint16(p + 10, true),
      data: words(view, p + 12, (length - 12) / 2),
    };
    tims.push({ bpp: [4, 8, 16, 24][flags & 3], clut, image });
    at = p + length;
  }
  return tims;
}

/**
 * The TIMs written into VRAM, as two 1024 × 512 planes of 16-bit words: images relative to the
 * slot's first texture page, palettes relative to its first palette row. They are separate because
 * both are stored relative to different bases, and in one plane palette rows 0 and 1 would land on
 * the images' top rows.
 */
export function vramOf(tims) {
  const images = new Uint16Array(VRAM_W * VRAM_H);
  const palettes = new Uint16Array(VRAM_W * VRAM_H);
  const put = (plane, rect) => {
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        plane[((rect.y + y) % VRAM_H) * VRAM_W + ((rect.x + x) % VRAM_W)] = rect.data[y * rect.w + x] ?? 0;
      }
    }
  };
  for (const tim of tims) {
    if (tim.clut) put(palettes, tim.clut);
    if (tim.image) put(images, tim.image);
  }
  return { images, palettes };
}

/** A 15-bit colour as RGBA8: black with no flag is the transparent colour. */
function rgba(colour) {
  if (colour === 0) return [0, 0, 0, 0];
  const five = (v) => (v << 3) | (v >> 2);
  return [five(colour & 31), five((colour >> 5) & 31), five((colour >> 10) & 31), 255];
}

/**
 * The 256 × 256 texels a texture page shows through a palette, as RGBA, from a VRAM of `height`
 * rows (the PlayStation's 512 unless it says otherwise).
 *
 * `page` is relative to the slot's first page: x in units of 64 VRAM words, and the colour mode
 * (0 four bits, 1 eight, 2 fifteen). `clut` is the palette's VRAM position relative to row 504.
 */
export function decodePage({ images, palettes, height = VRAM_H }, page, clut) {
  const out = new Uint8Array(256 * 256 * 4);
  const baseX = page.x * 64;
  const baseY = page.y * 256;
  for (let v = 0; v < 256; v += 1) {
    const row = ((baseY + v) % height) * VRAM_W;
    for (let u = 0; u < 256; u += 1) {
      let colour;
      if (page.mode === 0) {
        const word = images[row + ((baseX + (u >> 2)) % VRAM_W)] ?? 0;
        colour = palettes[clut.y * VRAM_W + clut.x + ((word >> ((u & 3) * 4)) & 15)] ?? 0;
      } else if (page.mode === 1) {
        const word = images[row + ((baseX + (u >> 1)) % VRAM_W)] ?? 0;
        colour = palettes[clut.y * VRAM_W + clut.x + ((word >> ((u & 1) * 8)) & 255)] ?? 0;
      } else {
        colour = images[row + ((baseX + u) % VRAM_W)] ?? 0;
      }
      out.set(rgba(colour), (v * 256 + u) * 4);
    }
  }
  return out;
}

/**
 * Where a polygon's attribute points, relative to the slot: the game adds the attribute's high
 * byte to texture page 6 and its low byte to palette word `0x7e00` (row 504).
 */
export function attributeTarget(attr) {
  const tpage = 6 + (attr >> 8);
  const clutWord = 0x7e00 + (attr & 0xff);
  return {
    page: { x: (tpage & 0xf) - 6, y: (tpage >> 4) & 1, mode: (tpage >> 7) & 3 },
    clut: { x: (clutWord & 0x3f) * 16, y: (clutWord >> 6) - 504 },
  };
}

/**
 * Where a GPU packet's texture words point, in absolute VRAM: the texture page word (x in units of
 * 64, y in units of 256, colour mode) and the palette word (x in units of 16, y a row).
 */
export function packetTarget(tpage, clut) {
  return {
    page: { x: tpage & 0xf, y: (tpage >> 4) & 1, mode: (tpage >> 7) & 3 },
    clut: { x: (clut & 0x3f) * 16, y: clut >> 6 },
  };
}

/**
 * One plane of VRAM with TIMs at their absolute coordinates, images and palettes together:
 * 1024 words wide and `height` rows, the PlayStation's 512 or the arcade board's 1024.
 */
export function absoluteVram(tims, height = VRAM_H) {
  const plane = new Uint16Array(VRAM_W * height);
  const put = (rect) => {
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) plane[((rect.y + y) % height) * VRAM_W + ((rect.x + x) % VRAM_W)] = rect.data[y * rect.w + x] ?? 0;
    }
  };
  for (const tim of tims) {
    if (tim.clut) put(tim.clut);
    if (tim.image) put(tim.image);
  }
  return { images: plane, palettes: plane, height };
}

/**
 * A texture atlas of the texels polygons actually sample: per texture page and palette, the
 * rectangle its polygons' UVs cover, decoded once and shelf-packed with a one-texel gap.
 *
 * `uses` is every polygon's target and UVs, and optionally the VRAM (`from`) its target is decoded
 * from (a picture copied over a face). Returns the RGBA atlas and, per polygon target, where a UV
 * lands in it: `place(target, [u, v])` gives atlas texel coordinates.
 */
/**
 * Texels of gutter around each region, repeating its edge. With multisampling, a pixel on a polygon's
 * edge is shaded at its centre, which may lie outside the polygon; its texture coordinate then
 * extrapolates past the polygon's texels, and an unpadded neighbour (transparent, and discarded by the
 * cutout) shows as a crack.
 */
const GUTTER = 4;

/** How many rings of clear texels round an opaque one take its colour. */
const BLEED = 4;

/**
 * The clear texels next to opaque ones given those texels' average colour, ring by ring, still
 * clear: a texture filtered (or enlarged) across a cutout's edge then blends the edge's own colour
 * rather than the clear texels' black, which drew a dark or coloured outline round every hole.
 */
function bleed(pixels, width, height) {
  for (let ring = 0; ring < BLEED; ring += 1) {
    const filled = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        if (pixels[at + 3] !== 0 || pixels[at] !== 0 || pixels[at + 1] !== 0 || pixels[at + 2] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const k = (ny * width + nx) * 4;
            if (pixels[k + 3] === 0 && pixels[k] === 0 && pixels[k + 1] === 0 && pixels[k + 2] === 0) continue;
            r += pixels[k];
            g += pixels[k + 1];
            b += pixels[k + 2];
            n += 1;
          }
        }
        if (n > 0) filled.push(at, Math.round(r / n), Math.round(g / n), Math.round(b / n));
      }
    }
    if (filled.length === 0) return;
    for (let i = 0; i < filled.length; i += 4) {
      const at = filled[i];
      /* Never black, so the next ring counts it as filled. */
      pixels[at] = filled[i + 1] || 1;
      pixels[at + 1] = filled[i + 2];
      pixels[at + 2] = filled[i + 3];
    }
  }
}

/**
 * A texel's place under a texture window, as the GPU wraps it: a coordinate keeps its bits under
 * the window's mask and takes the rest from the window's offset (`window` in texels: `mask`, `offset`
 * each way, or none).
 */
const windowed = (c, mask, offset) => (c & ~mask) | (offset & mask);

export function packAtlas(vram, uses) {
  const rects = new Map();
  for (const { target, uvs, from = vram } of uses) {
    const key = JSON.stringify(target);
    let r = rects.get(key);
    if (!r) {
      r = { target, from, u0: 255, v0: 255, u1: 0, v1: 0 };
      rects.set(key, r);
    }
    for (const [u, v] of uvs) {
      r.u0 = Math.min(r.u0, u);
      r.v0 = Math.min(r.v0, v);
      r.u1 = Math.max(r.u1, u);
      r.v1 = Math.max(r.v1, v);
    }
  }
  const list = [...rects.values()].sort((a, b) => b.v1 - b.v0 - (a.v1 - a.v0));
  const area = list.reduce((n, r) => n + (r.u1 - r.u0 + 1 + 2 * GUTTER) * (r.v1 - r.v0 + 1 + 2 * GUTTER), 0);
  const width = Math.max(256, 2 ** Math.ceil(Math.log2(Math.sqrt(area) * 1.15)));
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const r of list) {
    const w = r.u1 - r.u0 + 1 + 2 * GUTTER;
    const h = r.v1 - r.v0 + 1 + 2 * GUTTER;
    if (x + w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    r.x = x + GUTTER;
    r.y = y + GUTTER;
    x += w;
    shelf = Math.max(shelf, h);
  }
  const height = 2 ** Math.ceil(Math.log2(y + shelf));
  const atlas = new Uint8Array(width * height * 4);
  for (const r of list) {
    const texels = r.target ? decodePage(r.from, r.target.page, r.target.clut) : null;
    /* The gutter repeats the edge texels, as a clamp would. */
    for (let dv = -GUTTER; dv <= r.v1 - r.v0 + GUTTER; dv += 1) {
      for (let du = -GUTTER; du <= r.u1 - r.u0 + GUTTER; du += 1) {
        let u = r.u0 + Math.max(0, Math.min(r.u1 - r.u0, du));
        let v = r.v0 + Math.max(0, Math.min(r.v1 - r.v0, dv));
        const w = r.target?.window;
        if (w) {
          u = windowed(u, w.maskU, w.offsetU);
          v = windowed(v, w.maskV, w.offsetV);
        }
        const to = ((r.y + dv) * width + (r.x + du)) * 4;
        if (texels) atlas.set(texels.subarray((v * 256 + u) * 4, (v * 256 + u) * 4 + 4), to);
        else atlas.set([255, 255, 255, 255], to);
      }
    }
  }
  bleed(atlas, width, height);
  return {
    width,
    height,
    atlas,
    place(target, [u, v]) {
      const r = rects.get(JSON.stringify(target));
      return [r.x + u - r.u0, r.y + v - r.v0];
    },
    /** Whether any texel a polygon's texture coordinates span is clear. */
    clearIn(target, uvs) {
      if (!target) return false;
      const placed = uvs.map((uv) => this.place(target, uv));
      const [x0, x1] = [Math.min(...placed.map((p) => p[0])), Math.max(...placed.map((p) => p[0]))];
      const [y0, y1] = [Math.min(...placed.map((p) => p[1])), Math.max(...placed.map((p) => p[1]))];
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (atlas[(y * width + x) * 4 + 3] === 0) return true;
      return false;
    },
  };
}
