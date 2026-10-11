/**
 * Tekken 4's character model (`CHRTK4`, part 3 of a character's model container), decoded.
 *
 * - **Nodes**: `+0x64` and `+0x68` count them (the second the ones motions drive); from `+0xe0`,
 *   32 bytes each: the parent (-1 for the root), the offset from it (mm) and a rest rotation (three
 *   radians).
 * - **Lists**: `+0x88` holds 2 × 2 × 5 offsets, most of them 0; each list is a count and the offset
 *   of its DMA chain, 16 bytes a link: a `ref` tag (quadwords, address from the list) and two VIF
 *   codes, the first of which names what the link carries. Kind 0 opens a matrix palette of as many
 *   kind-1 links as its address says, each the node whose matrix goes in the next slot; kind 2 is a
 *   mesh drawn with the palette in place.
 * - **A mesh**: four UNPACKs, every fourth quadword from `0x5e`: positions (mm, in the bind pose),
 *   normals (with a fourth value), up to four weights, and the palette slots they go with (1-based).
 *   After them, its triangle strips, each a GIF tag and then items of s, t (floats over TEX0's
 *   size), the vertex and a word the vertex keeps wherever it is drawn (not the strip's), under GS
 *   state blocks (a packed GIF tag: ALPHA, CLAMP_1, TEX0_1, TEST) that change between them, and
 *   calls to the VU program between batches of them.
 */
import { unpackElements, vifCodes } from './vif.mjs';

const MAGIC = 'CHRTK4 ';

export function parseChrtk4(bytes) {
  if (new TextDecoder().decode(bytes.subarray(0, 7)) !== MAGIC) throw new Error('not a CHRTK4 model');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nodeCount = view.getUint32(0x64, true) + view.getUint32(0x68, true);
  const nodes = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const at = 0xe0 + i * 0x20;
    nodes.push({
      parent: view.getInt32(at, true),
      offset: [0, 1, 2].map((k) => view.getFloat32(at + 4 + k * 4, true)),
      rotation: [0, 1, 2].map((k) => view.getFloat32(at + 16 + k * 4, true)),
    });
  }
  const lists = [];
  for (let slot = 0; slot < 20; slot += 1) {
    const base = view.getUint32(0x88 + slot * 4, true);
    if (base !== 0) lists.push({ slot, meshes: parseList(bytes, view, base) });
  }
  return { nodes, driven: view.getUint32(0x68, true), lists };
}

function parseList(bytes, view, base) {
  const count = view.getUint32(base, true);
  const chain = base + view.getUint32(base + 4, true);
  const meshes = [];
  let palette = [];
  let opening = 0;
  for (let i = 0; i < count; i += 1) {
    const link = chain + i * 16;
    const tag = view.getUint32(link, true);
    const address = view.getUint32(link + 4, true);
    const kind = view.getUint32(link + 8, true) & 0xffffff;
    if (kind === 0) {
      palette = [];
      opening = address;
    } else if (kind === 1) {
      palette.push(address);
    } else if (kind === 2) {
      if (palette.length !== opening) throw new Error(`CHRTK4: a palette of ${palette.length} where ${opening} were opened`);
      const vertices = view.getUint32(link + 12, true) & 0xffffff;
      meshes.push(parseMesh(bytes, base + address, (tag & 0xffff) * 16, vertices, palette.slice()));
    }
  }
  return meshes;
}

function parseMesh(bytes, start, length, count, palette) {
  const unpacks = [];
  for (const code of vifCodes(bytes, start, start + length)) if (code.code === 'UNPACK') unpacks.push(code);
  const [positions, normals, weights, slots] = unpacks;
  if (unpacks.length !== 4 || positions.format !== 'V3-32' || slots.format !== 'V4-16' || positions.count !== count) {
    throw new Error(`CHRTK4: a mesh at ${start} is not the four arrays it should be`);
  }
  const vertices = [];
  const p = unpackElements(positions, true);
  const n = unpackElements(normals, true);
  const w = unpackElements(weights, true);
  const s = unpackElements(slots);
  for (let i = 0; i < count; i += 1) {
    const influences = [];
    for (let k = 0; k < 4; k += 1) {
      if (s[i][k] === 0) continue;
      influences.push({ node: palette[s[i][k] - 1], weight: w[i][k] });
    }
    vertices.push({ position: p[i], normal: n[i].slice(0, 3), extra: n[i][3], influences });
  }
  return { palette, vertices, strips: parseStrips(bytes, start + count * 0x34 + 0x24) };
}

/**
 * The strips after a mesh's arrays, each with the GS state in force when it is drawn. A one-quadword
 * UNPACK is a strip's GIF tag and the next its items; any other is a state block, which can come
 * anywhere (a texture changing between strips). The next mesh opens with a FLUSH.
 */
function parseStrips(bytes, header) {
  const strips = [];
  let state = null;
  let tag = null;
  let calls = 0;
  for (const code of vifCodes(bytes, header, bytes.byteLength)) {
    if (code.code === 'MSCAL') calls += 1;
    if (code.code === 'FLUSH' || (code.code === 'UNPACK' && code.format === 'V3-32')) break;
    if (code.code !== 'UNPACK' || code.format !== 'V4-32') continue;
    if (tag !== null) {
      if (tag.loops !== code.count) throw new Error('CHRTK4: strip items not as many as their tag says');
      const view = new DataView(code.bytes.buffer, code.bytes.byteOffset, code.bytes.byteLength);
      const items = [];
      for (let i = 0; i < code.count; i += 1) {
        items.push({ s: view.getFloat32(i * 16, true), t: view.getFloat32(i * 16 + 4, true), vertex: view.getUint32(i * 16 + 8, true), flag: view.getUint32(i * 16 + 12, true) });
      }
      if (state === null) throw new Error('CHRTK4: a strip before any GS state');
      strips.push({ ...state, prim: tag.prim, items });
      tag = null;
    } else if (code.count === 1) tag = readTag(code);
    else state = readState(code);
  }
  if (calls < 2) throw new Error('CHRTK4: a mesh without its calls');
  return strips;
}

function readTag(unpack) {
  const view = new DataView(unpack.bytes.buffer, unpack.bytes.byteOffset, unpack.bytes.byteLength);
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  return { loops: lo & 0x7fff, prim: (hi >>> 15) & 0x7ff };
}

/** The batch's GS state: a packed GIF tag and its registers, read by register. */
function readState(unpack) {
  const view = new DataView(unpack.bytes.buffer, unpack.bytes.byteOffset, unpack.bytes.byteLength);
  const tagHi = view.getUint32(4, true);
  const regs = view.getBigUint64(8, true);
  const nreg = tagHi >>> 28 || 16;
  const state = {};
  for (let k = 0; k < nreg; k += 1) {
    const reg = Number((regs >> BigInt(k * 4)) & 0xfn);
    const data = view.getBigUint64(16 + k * 16, true);
    const address = reg === 0xe ? view.getUint8(16 + k * 16 + 8) : reg;
    if (address === 0x06) state.tex0 = readTex0(data);
    else if (address === 0x08) state.clamp = readClamp(data);
    else if (address === 0x42) state.alpha = data;
    else if (address === 0x47) state.test = data;
  }
  return state;
}

const field = (v, at, bits) => Number((v >> BigInt(at)) & ((1n << BigInt(bits)) - 1n));

export function readTex0(v) {
  return {
    tbp: field(v, 0, 14), tbw: field(v, 14, 6), psm: field(v, 20, 6), tw: 1 << field(v, 26, 4), th: 1 << field(v, 30, 4),
    tcc: field(v, 34, 1), tfx: field(v, 35, 2), cbp: field(v, 37, 14), cpsm: field(v, 51, 4), csm: field(v, 55, 1), csa: field(v, 56, 5),
  };
}

function readClamp(v) {
  return { wms: field(v, 0, 2), wmt: field(v, 2, 2), minu: field(v, 4, 10), maxu: field(v, 14, 10), minv: field(v, 24, 10), maxv: field(v, 34, 10) };
}

/**
 * A character's textures (part 0 of its model container): GS image transfers, each a packed GIF tag
 * of A+D writes (BITBLTBUF, TRXPOS, TRXREG, TRXDIR) and then the pixels in IMAGE mode. Addresses are
 * relative, as the model's TEX0 are; the loader adds one base to both.
 */
export function parseUploads(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uploads = [];
  let regs = new Map();
  let at = 0;
  while (at + 16 <= bytes.byteLength) {
    const lo = view.getUint32(at, true);
    const hi = view.getUint32(at + 4, true);
    at += 16;
    const loops = lo & 0x7fff;
    const flag = (hi >>> 26) & 3;
    const nreg = hi >>> 28 || 16;
    if (flag === 0) {
      for (let k = 0; k < loops * nreg; k += 1) {
        regs.set(view.getUint8(at + 8), view.getBigUint64(at, true));
        at += 16;
      }
    } else if (flag === 2) {
      const blit = regs.get(0x50) ?? 0n;
      const pos = regs.get(0x51) ?? 0n;
      const size = regs.get(0x52) ?? 0n;
      uploads.push({
        dbp: field(blit, 32, 14), dbw: field(blit, 48, 6), psm: field(blit, 56, 6),
        x: field(pos, 32, 11), y: field(pos, 48, 11), width: field(size, 0, 12), height: field(size, 32, 12),
        pixels: bytes.subarray(at, at + loops * 16),
      });
      at += loops * 16;
      regs = new Map(regs);
    } else break;
  }
  return uploads;
}

const PSMCT32 = 0x00;
const PSMT8 = 0x13;
const PSMT4 = 0x14;
/** Blocks (256 bytes) in a page row for each format: a page is 8 KB, 64, 128 or 128 pixels wide. */
const PAGE = { [PSMCT32]: { width: 64, height: 32 }, [PSMT8]: { width: 128, height: 64 }, [PSMT4]: { width: 128, height: 128 } };

/**
 * The upload holding the texture at `tbp`, and the row the texture starts at in it: an upload read
 * back at its own format and width, at a whole number of page rows in, is the same pixels in the
 * same places, so no GS memory needs simulating.
 */
function findUpload(uploads, tbp, psm) {
  for (const upload of uploads) {
    if (upload.psm !== psm) continue;
    const pages = PAGE[psm];
    const blocksPerRow = 32 * Math.max(1, Math.ceil((upload.dbw * 64) / pages.width));
    const delta = tbp - upload.dbp;
    if (delta < 0 || delta % blocksPerRow !== 0) continue;
    const row = (delta / blocksPerRow) * pages.height;
    if (row < upload.height) return { upload, row };
  }
  return null;
}

/** A palette entry's place in a 16 × 16 CSM1 palette: entries 8 to 15 and 16 to 23 of every 32 swap. */
const csm1 = (i) => (i & 0xe7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1);

/**
 * The texture a strip draws, as RGBA rows over CLAMP's region (or TEX0's size), alpha doubled from
 * the GS's 0 to 128. A region clamp keeps the GS inside the region, which can be a corner of a page
 * other strips use, so only the region is decoded; `x` and `y` are its corner in the page.
 */
export function decodeTexture(uploads, tex0, clamp) {
  const found = findUpload(uploads, tex0.tbp, tex0.psm);
  if (found === null) throw new Error(`no upload holds the texture at ${tex0.tbp}`);
  const palette = found.upload.psm === PSMCT32 ? null : findPalette(uploads, tex0);
  const regionU = clamp && clamp.wms === 2;
  const regionV = clamp && clamp.wmt === 2;
  const left = regionU ? clamp.minu : 0;
  const top = regionV ? clamp.minv : 0;
  const width = regionU ? clamp.maxu + 1 - left : tex0.tw;
  const height = regionV ? clamp.maxv + 1 - top : Math.min(tex0.th, found.upload.height - found.row);
  const out = new Uint8Array(width * height * 4);
  const { upload, row } = found;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (row + top + y) * upload.width + left + x;
      let rgba;
      if (upload.psm === PSMT8) rgba = palette[upload.pixels[index]];
      else if (upload.psm === PSMT4) rgba = palette[(upload.pixels[index >> 1] >> ((index & 1) * 4)) & 15];
      else rgba = Array.from(upload.pixels.subarray(index * 4, index * 4 + 4));
      const o = (y * width + x) * 4;
      out[o] = rgba[0];
      out[o + 1] = rgba[1];
      out[o + 2] = rgba[2];
      out[o + 3] = Math.min(255, rgba[3] * 2);
    }
  }
  return { x: left, y: top, width, height, rgba: out };
}

function findPalette(uploads, tex0) {
  const upload = uploads.find((u) => u.dbp === tex0.cbp && u.psm === PSMCT32);
  if (upload === undefined) throw new Error(`no palette at ${tex0.cbp}`);
  const entries = tex0.psm === PSMT8 ? 256 : 16;
  const palette = [];
  for (let i = 0; i < entries; i += 1) {
    const at = (entries === 256 ? csm1(i) : i + tex0.csa * 16) * 4;
    palette.push(Array.from(upload.pixels.subarray(at, at + 4)));
  }
  return palette;
}
