/**
 * An arcade stage: its scenery model, cells on a square grid in 8 mm units and game axes, with
 * the texture pages its polygons draw from, as a stage mesh (`STG1` version 3,
 * scripts/lib/stage.mjs) and its atlas. A polygon's colours are its own, or shades the stage gives
 * it as the fight runs, which its vertices are flagged for.
 */
import { arcMembers } from '../bns.mjs';
import { decompress } from '../lz.mjs';
import { CUT, LAYER_SHIFT, ONE_SIDED, SHADED, writeStageMesh } from '../stage.mjs';
import { absoluteVram, packAtlas, readTimChain } from '../texture.mjs';

const MODEL_MAGIC = 0x41;
/** The most layers polygons stack in one plane; how near two planes are to be one (model units, and their normals' cosine); how far two polygons must overlap to lie over each other. */
const LAYERS = 3;
const PLANE = { distance: 1.5, cosine: 0.999 };
const OVERLAP = 0.5;
/** A panorama's tiles, texels each way; the share of its height that fades into the sky above it; the rows its sky's colour is taken from. */
const TILE = 64;
const FADE = 0.3;
const SKY_ROWS = 8;
/** The board's VRAM, twice the PlayStation's rows. */
const VRAM_ROWS = 1024;
/** A colour that leaves the texel as it is. */
const UNCHANGED = [128, 128, 128];

/** Where a polygon's texture words point: the page (its high bit the lower half of the VRAM) and the palette. */
function target(tpage, clut) {
  return {
    page: { x: tpage & 0xf, y: ((tpage >> 4) & 1) | ((tpage >> 10) & 2), mode: (tpage >> 7) & 3 },
    clut: { x: (clut & 0x3f) * 16, y: clut >> 6 },
  };
}

/** The words a polygon of this command takes, by whether its colours are stored. */
function length(code, stored) {
  const corners = (code & 8) !== 0 ? 4 : 3;
  const uvs = (code & 4) !== 0 ? corners : 0;
  if (stored) return 1 + uvs + ((code & 0x10) !== 0 ? corners : 1) + 2;
  /* An untextured polygon the stage shades carries its colour too. */
  return 1 + uvs + (uvs === 0 ? 1 : 0) + ((code & 0x10) !== 0 ? corners : Math.ceil((1 + corners) / 2));
}

/**
 * The model's polygons, each with its cell, its texture target (null when it has none), and its
 * corners' points, UVs, colours and whether the stage shades them; and its cell size and grid.
 */
export function readArcadeModel(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MODEL_MAGIC) throw new Error('not an arcade stage model');
  const cellSize = view.getUint32(4, true);
  const cellCount = view.getUint32(8, true);
  const grid = Math.round(Math.sqrt(cellCount));
  if (grid * grid !== cellCount) throw new Error(`${cellCount} cells are not a square grid`);
  const polygons = [];
  for (let c = 0; c < cellCount; c += 1) {
    const e = (k) => view.getInt32(12 + c * 28 + k * 4, true);
    const vertexAt = 12 + e(0);
    const vertexCount = e(1);
    const count = e(5);
    const vertex = (id) => {
      if (!(id < vertexCount)) throw new Error(`cell ${c}: vertex ${id} of ${vertexCount}`);
      return [view.getInt16(vertexAt + id * 8, true), view.getInt16(vertexAt + id * 8 + 2, true), view.getInt16(vertexAt + id * 8 + 4, true)];
    };
    let at = 12 + e(4);
    for (let p = 0; p < count; p += 1) {
      const w0 = view.getUint32(at, true);
      const code = w0 >>> 24;
      const words = ((w0 >>> 8) & 0xff) + 1;
      const stored = ((w0 >>> 16) & 0xff) === 1;
      if ((code & 0x60) !== 0x20 || words !== length(code, stored)) throw new Error(`cell ${c}: polygon ${p} (${w0.toString(16)}) is not one the stage reader knows`);
      const n = (code & 8) !== 0 ? 4 : 3;
      const word = (k) => view.getUint32(at + 4 + k * 4, true);
      const half = (k) => view.getUint16(at + 4 + k * 2, true);
      let k = 0;
      let polygonTarget = null;
      let uvs = Array.from({ length: n }, () => [0, 0]);
      if ((code & 4) !== 0) {
        polygonTarget = target(word(1) >>> 16, word(0) >>> 16);
        uvs = Array.from({ length: n }, (_, i) => [word(i) & 0xff, (word(i) >>> 8) & 0xff]);
        k = n;
      }
      let colours;
      let ids;
      if (stored) {
        const each = (code & 0x10) !== 0;
        colours = Array.from({ length: n }, (_, i) => {
          const rgb = word(k + (each ? i : 0));
          return [rgb & 0xff, (rgb >>> 8) & 0xff, (rgb >>> 16) & 0xff];
        });
        k += each ? n : 1;
        ids = Array.from({ length: n }, (_, i) => half(k * 2 + i));
      } else {
        if ((code & 4) === 0) {
          /* Untextured, its colour shows as it is: halved, as a texel's colour is over 128. */
          const rgb = word(k);
          colours = Array.from({ length: n }, () => [rgb & 0xff, (rgb >>> 8) & 0xff, (rgb >>> 16) & 0xff].map((c) => c >> 1));
          k += 1;
        } else colours = Array.from({ length: n }, () => UNCHANGED);
        ids = (code & 0x10) !== 0 ? Array.from({ length: n }, (_, i) => half(k * 2 + i * 2 + 1)) : Array.from({ length: n }, (_, i) => half(k * 2 + 1 + i));
      }
      /* A polygon of the flagged kinds tiles its texture through a window: a rectangle in its page, from its third and fourth UV words' spare halves. */
      if ((code & 0x80) !== 0 && polygonTarget !== null) {
        const byte = (k) => view.getUint8(at + k);
        const mask = (size) => (-size & 0xff) & ~7;
        polygonTarget = { ...polygonTarget, window: { maskU: mask(byte(0xe)), offsetU: byte(0x12) & ~7, maskV: mask(byte(0xf)), offsetV: byte(0x13) & ~7 } };
      }
      polygons.push({
        cell: c,
        target: polygonTarget,
        shaded: !stored,
        /* The stage's polygons are each drawn from their front only. */
        oneSided: true,
        corners: ids.map((id, i) => ({ p: vertex(id), uv: uvs[i], rgb: colours[i] })),
      });
      at += words * 4;
    }
  }
  stackLayers(polygons);
  return { cellSize, grid, polygons };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A polygon's plane (unit normal and distance), or null for one with no area. */
function planeOf(points) {
  const n = cross(sub(points[1], points[0]), sub(points[2], points[0]));
  const length = Math.hypot(...n);
  if (length === 0) return null;
  const normal = n.map((v) => v / length);
  return { normal, distance: dot(normal, points[0]) };
}

/** Whether two convex outlines in a plane overlap by more than `OVERLAP` along every axis that could part them. */
function overlap(a, b) {
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i += 1) {
      const [x0, y0] = shape[i];
      const [x1, y1] = shape[(i + 1) % shape.length];
      const axis = [y1 - y0, x0 - x1];
      const length = Math.hypot(...axis);
      if (length === 0) continue;
      const project = (points) => points.map(([x, y]) => (x * axis[0] + y * axis[1]) / length);
      const pa = project(a);
      const pb = project(b);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= OVERLAP) return false;
    }
  }
  return true;
}

/**
 * Each polygon's layer: one above the highest of the polygons before it that it lies over in the
 * same plane (a decal on its wall, a mark on its floor), which a depth buffer cannot otherwise tell
 * apart, and 0 for the rest.
 */
function stackLayers(polygons) {
  const planes = polygons.map((p) => planeOf(p.corners.map((c) => c.p)));
  const bounds = polygons.map((p) => [0, 1, 2].map((k) => [Math.min(...p.corners.map((c) => c.p[k])), Math.max(...p.corners.map((c) => c.p[k]))]));
  polygons.forEach((p, i) => {
    p.layer = 0;
    const plane = planes[i];
    if (plane === null) return;
    /* The plane's own two axes, to lay both outlines flat in it. */
    const across = Math.abs(plane.normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(plane.normal, across).map((v, _, a) => v / Math.hypot(...a));
    const v = cross(plane.normal, u);
    const flat = (q) => q.corners.map((c) => [dot(c.p, u), dot(c.p, v)]);
    for (let j = 0; j < i; j += 1) {
      const other = planes[j];
      if (other === null || polygons[j].layer + 1 <= p.layer) continue;
      if (bounds[i].some(([lo, hi], k) => hi < bounds[j][k][0] - PLANE.distance || bounds[j][k][1] + PLANE.distance < lo)) continue;
      const facing = dot(plane.normal, other.normal);
      if (Math.abs(facing) < PLANE.cosine || Math.abs(plane.distance - Math.sign(facing) * other.distance) > PLANE.distance) continue;
      if (overlap(flat(p), flat(polygons[j]))) p.layer = Math.min(LAYERS, polygons[j].layer + 1);
    }
  });
}

/**
 * A stage's files from its archive: the scenery mesh and the atlas of its texture pages; and for
 * each flipbook (a run of frames' textures, from `program`), its polygons taken out of the scenery
 * and drawn once a frame, each frame a cell of a mesh of its own.
 */
export function exportArcadeStage(archive, encodePng, flipbooks = [], program = null) {
  const [model, ...pages] = arcMembers(Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength));
  const { cellSize, grid, polygons } = readArcadeModel(model);
  /* A page stored compressed is read once unpacked. */
  const tims = pages.flatMap((page) => readTimChain(page.readUInt32LE(0) === 0x10 ? page : decompress(page, 0)));
  let scenery = polygons;
  const books = flipbooks.map(([from, to]) => {
    const frames = readTimChain(program.subarray(from, to));
    const slot = closestTexture(
      tims.filter((t) => t.image !== null && scenery.some((p) => p.target !== null && texelsIn(p, t.image))),
      frames[0],
    );
    const inSlot = (p) => p.target !== null && texelsIn(p, slot.image);
    const own = scenery.filter(inSlot);
    scenery = scenery.filter((p) => !inSlot(p));
    const cells = Math.ceil(Math.sqrt(frames.length));
    const shown = frames.flatMap((frame, k) => own.map((p) => ({ ...p, cell: k, ...onFrame(p, slot.image, frame) })));
    return writeArcadeMesh(shown, absoluteVram(frames, VRAM_ROWS), 0, cells, encodePng);
  });
  return { ...writeArcadeMesh(scenery, absoluteVram(tims, VRAM_ROWS), cellSize, grid, encodePng), books };
}

/** A texture's texels as colours, for comparing. */
function coloursOf(tim) {
  const w = (tim.image.w * 16) / tim.bpp;
  const out = new Float32Array(w * tim.image.h * 3);
  for (let y = 0; y < tim.image.h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const word = tim.image.data[y * tim.image.w + (tim.bpp === 4 ? x >> 2 : x >> 1)];
      const index = tim.bpp === 4 ? (word >> ((x & 3) * 4)) & 15 : (word >> ((x & 1) * 8)) & 255;
      const c = tim.clut?.data[index] ?? 0;
      out.set([c & 31, (c >> 5) & 31, (c >> 10) & 31], (y * w + x) * 3);
    }
  }
  return out;
}

/** Of the textures of the frame's size and depth that the stage's polygons show, the one most like it. */
function closestTexture(tims, frame) {
  const want = coloursOf(frame);
  let best = null;
  for (const tim of tims) {
    if (tim.image === null || tim.bpp !== frame.bpp || tim.image.w !== frame.image.w || tim.image.h !== frame.image.h) continue;
    const have = coloursOf(tim);
    let d = 0;
    for (let i = 0; i < have.length; i += 1) d += Math.abs(have[i] - want[i]);
    if (best === null || d < best.d) best = { tim, d };
  }
  if (best === null) throw new Error('no stage texture of the frames\' size');
  return best.tim;
}

/** A polygon's texels in VRAM words: its page's corner plus its UVs, over the texels a word holds. */
function wordsOf(p) {
  const per = [4, 2, 1][p.target.page.mode];
  const us = p.corners.map((c) => c.uv[0]);
  const vs = p.corners.map((c) => c.uv[1]);
  const x = p.target.page.x * 64;
  const y = p.target.page.y * 256;
  return { x0: x + Math.floor(Math.min(...us) / per), x1: x + Math.floor(Math.max(...us) / per), y0: y + Math.min(...vs), y1: y + Math.max(...vs), per };
}

/** Whether a polygon samples only texels inside an image's rectangle. */
function texelsIn(p, image) {
  const w = wordsOf(p);
  return image.x <= w.x0 && w.x1 < image.x + image.w && image.y <= w.y0 && w.y1 < image.y + image.h;
}

/** A polygon's texture target and UVs moved from the slot's image to a frame's, the same texels within it. */
function onFrame(p, slot, frame) {
  const per = 16 / frame.bpp;
  const page = { x: Math.floor(frame.image.x / 64), y: Math.floor(frame.image.y / 256), mode: p.target.page.mode };
  const slotU = (slot.x - p.target.page.x * 64) * per;
  const slotV = slot.y - p.target.page.y * 256;
  const frameU = (frame.image.x - page.x * 64) * per;
  const frameV = frame.image.y - page.y * 256;
  return {
    target: { page, clut: { x: frame.clut.x, y: frame.clut.y } },
    corners: p.corners.map((c) => ({ ...c, uv: [c.uv[0] - slotU + frameU, c.uv[1] - slotV + frameV] })),
  };
}

/** Polygons as a stage mesh and its atlas, with their flags. */
function writeArcadeMesh(polygons, vram, cellSize, grid, encodePng) {
  const packed = packAtlas(
    vram,
    polygons.map((p) => ({ target: p.target, uvs: p.corners.map((c) => c.uv) })),
  );
  const vertices = [];
  const indices = [];
  const cellRanges = Array.from({ length: grid * grid }, () => [0, 0]);
  for (const polygon of polygons) {
    const base = vertices.length;
    if (cellRanges[polygon.cell][1] === 0) cellRanges[polygon.cell][0] = indices.length;
    const cut = packed.clearIn(polygon.target, polygon.corners.map((c) => c.uv));
    const flags = (polygon.shaded ? SHADED : 0) | (polygon.oneSided ? ONE_SIDED : 0) | (polygon.layer << LAYER_SHIFT) | (cut ? CUT : 0);
    for (const corner of polygon.corners) vertices.push({ p: corner.p, rgb: corner.rgb, flags, uv: packed.place(polygon.target, corner.uv) });
    /* Wound the other way from the PlayStation's order, so a polygon's front faces the engine's way. */
    if (polygon.corners.length === 3) indices.push(base, base + 2, base + 1);
    else indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    cellRanges[polygon.cell][1] = indices.length - cellRanges[polygon.cell][0];
  }
  const mesh = writeStageMesh({ vertices, indices, cellRanges, width: packed.width, height: packed.height, cellSize, grid });
  const layered = polygons.filter((p) => p.layer > 0).length;
  return { mesh, atlas: encodePng(packed.width, packed.height, packed.atlas), stats: { polygons: polygons.length, layered, atlas: [packed.width, packed.height], cellSize, grid } };
}

/** A 15-bit colour as RGB8. */
const rgb8 = (colour) => [colour & 31, (colour >> 5) & 31, (colour >> 10) & 31].map((v) => (v << 3) | (v >> 2));

/**
 * A stage's panorama: its tiles (4-bit, 64 texels square, each with its own palette) laid
 * `columns` a row, every texel opaque, its top fading out so the sky above shows through; and the
 * colours of its top and bottom rows, which the sky above and below it takes.
 */
export function exportArcadePanorama(archive, { first, count, columns }, encodePng) {
  const [, ...pages] = arcMembers(Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength));
  const tiles = pages.flatMap((page) => readTimChain(page)).slice(first, first + count);
  if (tiles.length !== count || tiles.some((t) => t.bpp !== 4 || t.image === null || t.image.w * 4 !== TILE || t.image.h !== TILE)) throw new Error('not a panorama of 64-texel tiles');
  const width = columns * TILE;
  const height = Math.ceil(count / columns) * TILE;
  const pixels = new Uint8Array(width * height * 4);
  tiles.forEach((tile, i) => {
    const x0 = (i % columns) * TILE;
    const y0 = Math.floor(i / columns) * TILE;
    for (let y = 0; y < TILE; y += 1) {
      for (let x = 0; x < TILE; x += 1) {
        const index = (tile.image.data[y * (TILE / 4) + (x >> 2)] >> ((x & 3) * 4)) & 15;
        pixels.set([...rgb8(tile.clut.data[index] ?? 0), 255], ((y0 + y) * width + x0 + x) * 4);
      }
    }
  });
  const average = (from) => {
    const sum = [0, 0, 0];
    for (let i = from * width; i < (from + SKY_ROWS) * width; i += 1) for (let k = 0; k < 3; k += 1) sum[k] += pixels[i * 4 + k];
    return sum.map((v) => Math.round(v / (width * SKY_ROWS)));
  };
  const top = average(0);
  const bottom = average(height - SKY_ROWS);
  const fade = Math.round(height * FADE);
  for (let y = 0; y < fade; y += 1) for (let x = 0; x < width; x += 1) pixels[(y * width + x) * 4 + 3] = Math.round((255 * y) / fade);
  return { atlas: encodePng(width, height, pixels), top, bottom, size: [width, height] };
}

/**
 * A stage's moving piece from the board's program: each of its parts' models a cell of one stage
 * mesh, in the part's own frame (the piece and its parts are placed and turned as they move), and
 * the atlas of the texture chains they draw from.
 */
export function exportArcadeObject(program, { parts, textures }, encodePng) {
  const polygons = parts.flatMap(({ model }, cell) => readArcadeModel(program.subarray(model)).polygons.map((p) => ({ ...p, cell })));
  const vram = absoluteVram(
    textures.flatMap(([from, to]) => readTimChain(program.subarray(from, to))),
    VRAM_ROWS,
  );
  return writeArcadeMesh(polygons, vram, 0, Math.ceil(Math.sqrt(parts.length)), encodePng);
}
