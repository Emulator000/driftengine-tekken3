/**
 * The `3DMK` fighter model, decoded as the game's part renderer reads it: each part drawn from its
 * record, its polygon packets built once.
 *
 * A model is a header and 27 part records. A record's words are offsets from the model's start:
 *   0 vertices   1 alternative vertices (hand shapes)   2 normals   3 polygons   4 texturing
 *   5..7 the joint's offset from its parent, in millimetres (the game negates z)
 *   8 the parent record, or -1
 */

const RECORD = 0x38;

/** A little reader over a model's bytes. */
function cursor(bytes, at) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    get at() {
      return at;
    },
    u32() {
      const v = view.getUint32(at, true);
      at += 4;
      return v;
    },
    i16(o) {
      return view.getInt16(o, true);
    },
    u16(o) {
      return view.getUint16(o, true);
    },
    word(o) {
      return view.getUint32(o, true);
    },
    skip(n) {
      at += n;
    },
  };
}

/**
 * A packed list as the renderer walks it: a count, then entries of `bits` bits taken from the low
 * end of 32-bit words. **A new word is fetched whenever the current one has become zero**, not after
 * a fixed number of entries: that is how the game reads it, and so how it must be read here.
 */
function packed(c, bits) {
  const count = c.u32();
  const mask = (1 << bits) - 1;
  const out = [];
  let word = 0;
  for (let i = 0; i < count; i += 1) {
    if (word === 0) word = c.u32();
    out.push(word & mask);
    word = word >>> bits;
  }
  return out;
}

/** The two copy-in lists, the own items, then the per-vertex lists that follow them. */
function vertexBlock(bytes, offset, withStitch) {
  const c = cursor(bytes, offset);
  const ownStart = c.u32();
  const fromPrevious = packed(c, 8);
  const fromCache = packed(c, 8);
  const own = [];
  const ownCount = c.u32();
  for (let i = 0; i < ownCount; i += 1) {
    const o = c.at;
    own.push([c.i16(o), c.i16(o + 2), c.i16(o + 4)]);
    c.skip(8);
  }
  if (!withStitch) {
    return { ownStart, fromPrevious, fromCache, own, end: c.at };
  }
  /* The stitch count is the first word after the vertices, read the way the renderer reads it. */
  const stitch = packed(c, 9);
  const addFrom = [packed(c, 9), packed(c, 9)];
  const publish = [packed(c, 9), packed(c, 9)];
  const halve = packed(c, 2);
  return { ownStart, fromPrevious, fromCache, own, stitch, addFrom, publish, halve, end: c.at };
}

/**
 * A hand's shapes: a table of offsets indexed by the hand's state, each to a whole vertex block
 * (the game points the record's vertices at one of them), or 0 to keep the block drawn. Most
 * entries repeat the first. The table runs to `end`, the next block any record names; each
 * distinct block is decoded once. With `from` (`{ bytes, base }`) every entry past the first lies
 * in those bytes from `base` instead of in the model.
 */
function shapeBlocks(bytes, offset, end, from = null) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = [];
  for (let at = offset; at + 4 <= end; at += 4) table.push(view.getUint32(at, true));
  const decoded = new Map();
  const blockAt = (source, start, key) => {
    if (!decoded.has(key)) {
      if (start < 16 || start >= source.length) throw new Error(`a hand shape at 0x${start.toString(16)} lies outside its bytes`);
      decoded.set(key, vertexBlock(source, start, true));
    }
    return decoded.get(key);
  };
  /* Per entry, the block it draws, or null where it keeps the one drawn. */
  const steps = table.map((entry, k) => {
    if (entry === 0) return null;
    return from !== null && k > 0 ? blockAt(from.bytes, from.base + entry, `from ${entry}`) : blockAt(bytes, entry, `model ${entry}`);
  });
  return { table, steps };
}

/** The normal block: copy-in lists, the normals, then where each lit colour is published. */
function normalBlock(bytes, offset) {
  const c = cursor(bytes, offset);
  const ownStart = c.u32();
  const fromPrevious = packed(c, 8);
  const fromCache = packed(c, 8);
  const own = [];
  const ownCount = c.u32();
  for (let i = 0; i < ownCount; i += 1) {
    const o = c.at;
    own.push([c.i16(o), c.i16(o + 2), c.i16(o + 4)]);
    c.skip(8);
  }
  const publish = [packed(c, 8), packed(c, 8)];
  return { ownStart, fromPrevious, fromCache, own, publish, end: c.at };
}

/**
 * The four polygon lists: flat triangles, flat quads, smooth triangles, smooth quads. Each
 * polygon's vertex references are byte offsets into the part's transformed vertices (four bytes a
 * vertex), its colour references the same into its lit colours.
 */
function polygonBlock(bytes, offset) {
  const c = cursor(bytes, offset);
  const lists = { ft3: [], ft4: [], gt3: [], gt4: [] };
  const flags = (w) => ({ doubleSided: (w & 0x1000000) !== 0, bias: w >> 25 });
  let n = c.u32();
  for (let i = 0; i < n; i += 1) {
    const w = c.u32();
    const k = c.u32();
    lists.ft3.push({ v: [(w & 0x1fc) >> 2, ((w >> 7) & 0x1fc) >> 2, ((w >> 14) & 0x1fc) >> 2], c: [k >> 2], ...flags(w) });
  }
  n = c.u32();
  for (let i = 0; i < n; i += 1) {
    const w = c.u32();
    const k = c.u32();
    lists.ft4.push({ v: [(w & 0x1fc) >> 2, ((w >> 7) & 0x1fc) >> 2, ((w >> 14) & 0x1fc) >> 2, (w >>> 23) >> 2], c: [(k & 0x1fc) >> 2], ...flags(k) });
  }
  n = c.u32();
  for (let i = 0; i < n; i += 1) {
    const w = c.u32();
    const k = c.u32();
    lists.gt3.push({
      v: [(w & 0x1fc) >> 2, ((w >> 7) & 0x1fc) >> 2, ((w >> 14) & 0x1fc) >> 2],
      c: [(k & 0x1fc) >> 2, ((k >> 7) & 0x1fc) >> 2, (k >>> 16) >> 2],
      ...flags(w),
    });
  }
  n = c.u32();
  for (let i = 0; i < n; i += 1) {
    const w = c.u32();
    const k = c.u32();
    const m = c.u32();
    lists.gt4.push({
      v: [(w & 0x1fc) >> 2, ((w >> 7) & 0x1fc) >> 2, ((w >> 14) & 0x1fc) >> 2, (w >>> 23) >> 2],
      c: [(k & 0x1fc) >> 2, (m & 0x1fc) >> 2, ((m >> 7) & 0x1fc) >> 2, (m >>> 16) >> 2],
      ...flags(k),
    });
  }
  return lists;
}

/**
 * The texturing block: an attribute table (palette offset in the low byte, texture page bits in the
 * high), a table of UV pairs, then per polygon list a count and, per polygon, its attribute and one
 * UV per corner, in the polygon lists' order.
 */
function textureBlock(bytes, offset) {
  const c = cursor(bytes, offset);
  const uvTableAt = offset + c.u16(offset);
  const listAt = uvTableAt + c.u16(uvTableAt);
  /* Indexed directly, as the game indexes them: entry i is at table + 2 + 2i. */
  const attr = (i) => c.u16(offset + 2 + i * 2);
  const uv = (i) => {
    const v = c.u16(uvTableAt + 2 + i * 2);
    return [v & 0xff, v >> 8];
  };
  let at = listAt;
  const read = (corners) => {
    const count = bytes[at];
    at += 1;
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push({ attr: attr(bytes[at]), uv: Array.from({ length: corners }, (_, k) => uv(bytes[at + 1 + k])) });
      at += 1 + corners;
    }
    return out;
  };
  return { ft3: read(3), ft4: read(4), gt3: read(3), gt4: read(4) };
}

/**
 * A model: its records, each with its blocks decoded. `shapesFrom` (`{ record, bytes, base }`)
 * says where one record's hand shapes past the first lie, outside the model.
 */
export function parseModel(bytes, { shapesFrom = null } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== '3DMK') throw new Error('not a 3DMK model');
  const count = view.getUint32(0, true);
  const starts = [];
  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < 5; k += 1) {
      const w = view.getInt32(16 + i * RECORD + k * 4, true);
      if (w > 0) starts.push(w);
    }
  }
  /** The first block any record names after `at`: where a table that has no length ends. */
  const nextBlock = (at) => Math.min(...starts.filter((w) => w > at), bytes.length);
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const at = 16 + i * RECORD;
    const word = (k) => view.getInt32(at + k * 4, true);
    if (word(0) === 0) {
      records.push(null);
      continue;
    }
    records.push({
      index: i,
      vertices: vertexBlock(bytes, word(0), true),
      shapes: word(1) ? shapeBlocks(bytes, word(1), nextBlock(word(1)), shapesFrom?.record === i ? shapesFrom : null) : null,
      normals: word(2) ? normalBlock(bytes, word(2)) : null,
      polygons: word(3) ? polygonBlock(bytes, word(3)) : null,
      texture: word(4) ? textureBlock(bytes, word(4)) : null,
      offset: [word(5), word(6), word(7)],
      parent: word(8),
      /* An accessory joint's rest rotation, three 16-bit angles. */
      rest: [word(9), word(10), word(11)],
    });
  }
  return { records };
}

/** For diagnosis: each record's blocks decoded separately, errors reported instead of thrown. */
export function probeModel(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let i = 0; i < view.getUint32(0, true); i += 1) {
    const word = (k) => view.getInt32(16 + i * RECORD + k * 4, true);
    if (word(0) === 0) continue;
    const tryBlock = (name, fn) => {
      try {
        fn();
        return null;
      } catch (e) {
        return `${name}: ${e.message}`;
      }
    };
    out.push({
      index: i,
      errors: [
        tryBlock('vertices', () => vertexBlock(bytes, word(0), true)),
        word(1) ? tryBlock('shapes', () => shapeBlocks(bytes, word(1), word(1) + 4)) : null,
        word(2) ? tryBlock('normals', () => normalBlock(bytes, word(2))) : null,
        word(3) ? tryBlock('polygons', () => polygonBlock(bytes, word(3))) : null,
        word(4) ? tryBlock('texture', () => textureBlock(bytes, word(4))) : null,
      ].filter(Boolean),
    });
  }
  return out;
}

/**
 * A transformed vertex, as a weighted sum of joint-space points: what the renderer's screen-space
 * arithmetic computes, kept symbolic so it can be evaluated with any pose.
 */
const term = (joint, p, w) => ({ joint, p, w });
const scaled = (expr, k) => expr.map((t) => term(t.joint, t.p, t.w * k));
function sum(a, b) {
  const out = a.map((t) => ({ ...t }));
  for (const t of b) {
    const same = out.find((u) => u.joint === t.joint && u.p[0] === t.p[0] && u.p[1] === t.p[1] && u.p[2] === t.p[2]);
    if (same) same.w += t.w;
    else out.push({ ...t });
  }
  return out;
}

/**
 * Every polygon of a fighter, its corners resolved to joint-space positions and normals, by
 * drawing the parts in the order the game draws them.
 *
 * `parts` is the executable's part table: per part, its record, its joint, whether it is drawn,
 * and whether the record after it is drawn too with the same joint.
 *
 * The renderer keeps two vertex caches. The scratch one is the previous mesh's own vertex array,
 * read one slot back (`index / 2 - 1`) and written in place; the global one (`index / 2`) lasts the
 * whole fighter. Colours have the same pair. Both are simulated exactly, in place.
 */
export function resolveFighter(model, parts) {
  const local = new Array(128).fill(null);
  const cache = new Array(128).fill(null);
  const localColour = new Array(128).fill(null);
  const cacheColour = new Array(128).fill(null);
  const polygons = [];
  const problems = [];

  const slotA = (idx) => (idx >> 1) - 1;
  const slotB = (idx) => idx >> 1;

  const drawRecord = (recordIndex, joint, part) => {
    const record = model.records[recordIndex];
    /* A character without this optional part or secondary mesh: the game skips it too. */
    if (!record) return;
    const vb = record.vertices;
    let w = 0;
    for (const idx of vb.fromPrevious) local[w++] = local[slotA(idx)];
    for (const idx of vb.fromCache) local[w++] = cache[slotB(idx)];
    if (w * 2 + 2 !== vb.ownStart) problems.push(`record ${recordIndex}: ${w} shared but own starts at ${vb.ownStart}`);
    const own = w;
    for (const p of vb.own) local[w++] = [term(joint, p, 1)];
    let s = own;
    const value = (slot) => local[slot] ?? [];
    for (const e of vb.stitch) {
      const idx = e & 0xff;
      const v = sum(e & 0x100 ? scaled(value(s), 0.5) : value(s), cache[slotB(idx)] ?? []);
      cache[slotB(idx)] = v;
      local[s++] = v;
    }
    vb.addFrom.forEach((list, which) => {
      for (const e of list) {
        const idx = e & 0xff;
        const from = which === 0 ? cache[slotB(idx)] : local[slotA(idx)];
        local[s] = sum(from ?? [], e & 0x100 ? scaled(value(s), 0.5) : value(s));
        s += 1;
      }
    });
    vb.publish.forEach((list, which) => {
      for (const e of list) {
        const idx = e & 0xff;
        if (e & 0x100) local[s] = scaled(value(s), 0.5);
        if (which === 0) cache[slotB(idx)] = local[s];
        else local[slotA(idx)] = local[s];
        s += 1;
      }
    });
    for (const code of vb.halve) {
      if (code !== 1) local[s] = scaled(value(s), 0.5);
      s += 1;
    }

    const nb = record.normals;
    if (nb) {
      let c = 0;
      for (const idx of nb.fromPrevious) localColour[c++] = localColour[slotA(idx)];
      for (const idx of nb.fromCache) localColour[c++] = cacheColour[slotB(idx)];
      let k = c;
      for (const n of nb.own) localColour[c++] = { joint, n };
      nb.publish.forEach((list, which) => {
        for (const idx of list) {
          if (which === 0) cacheColour[slotB(idx)] = localColour[k];
          else localColour[slotA(idx)] = localColour[k];
          k += 1;
        }
      });
    }

    const pg = record.polygons;
    const tx = record.texture;
    if (!pg) return;
    for (const kind of ['ft3', 'ft4', 'gt3', 'gt4']) {
      pg[kind].forEach((poly, i) => {
        const tex = tx?.[kind]?.[i];
        const corners = poly.v.map((slot, k) => ({
          position: local[slot],
          /* Colour references count from 0x1f800290, one word before the colour array starts. */
          normal: localColour[(poly.c.length === 1 ? poly.c[0] : poly.c[k]) - 1],
          uv: tex?.uv[k],
        }));
        for (const corner of corners) {
          const weight = (corner.position ?? []).reduce((a, t) => a + t.w, 0);
          if (Math.abs(weight - 1) > 1e-9) problems.push(`record ${recordIndex} ${kind} ${i}: a corner weighs ${weight}`);
        }
        polygons.push({ record: recordIndex, part, kind, attr: tex?.attr, doubleSided: poly.doubleSided, corners });
      });
    }
  };

  for (const part of parts) {
    if (!part.drawn) continue;
    drawRecord(part.record, part.joint, part.index);
    if (part.secondary) drawRecord(part.record + 1, part.joint, part.index);
  }
  return { polygons, problems };
}
