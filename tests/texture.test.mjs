/**
 * The texture atlas: each region a polygon samples is padded with copies of its edge texels, so a
 * multisampled edge pixel shaded outside its polygon still lands on the polygon's own texels. And a
 * chain of TIMs read past a palette-only one (Gon's textures open with one).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { packAtlas, readTimChain } from '../scripts/lib/texture.mjs';

test('an atlas region is surrounded by copies of its edge texels', () => {
  /* A 16-bit direct-colour page whose texel (u, v) is a colour distinct for each position. */
  const images = new Uint16Array(1024 * 512);
  for (let v = 0; v < 64; v += 1) for (let u = 0; u < 64; u += 1) images[v * 1024 + u] = 0x8000 | (u & 31) | ((v & 31) << 5);
  const target = { page: { x: 0, y: 0, mode: 2 }, clut: { x: 0, y: 0 } };
  const atlas = packAtlas({ images, palettes: images }, [{ target, uvs: [[10, 20], [13, 20], [10, 22], [13, 22]] }]);
  const texel = (x, y) => Array.from(atlas.atlas.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4));
  const [x0, y0] = atlas.place(target, [10, 20]);
  const [x1, y1] = atlas.place(target, [13, 22]);
  for (let d = 1; d <= 4; d += 1) {
    assert.deepEqual(texel(x0 - d, y0), texel(x0, y0), `left gutter ${d}`);
    assert.deepEqual(texel(x1 + d, y1), texel(x1, y1), `right gutter ${d}`);
    assert.deepEqual(texel(x0, y0 - d), texel(x0, y0), `top gutter ${d}`);
    assert.deepEqual(texel(x1, y1 + d), texel(x1, y1), `bottom gutter ${d}`);
    assert.deepEqual(texel(x0 - d, y0 - d), texel(x0, y0), `corner ${d}`);
  }
  assert.notDeepEqual(texel(x0, y0), texel(x1, y1));
});

/** A 4-bit TIM's bytes: a 16-colour palette at `clut`, and an image of `w` halfwords by `h` lines at `at`, or only its length word when `w` is 0. */
function tim(clut, at, w, h) {
  const image = w === 0 ? [4] : [12 + w * h * 2, at[0] | (at[1] << 16), w | (h << 16), ...new Array(Math.ceil((w * h) / 2)).fill(0x11111111)];
  const words = [0x10, 8, 12 + 32, clut[0] | (clut[1] << 16), 16 | (1 << 16), ...new Array(8).fill(0x7fff7fff), ...image];
  return new Uint8Array(new Uint32Array(words).buffer);
}

test('a chain of TIMs reads on past a palette-only one, its image null', () => {
  const bytes = new Uint8Array([...tim([240, 2], [0, 0], 0, 0), ...tim([0, 0], [16, 8], 4, 2)]);
  const tims = readTimChain(bytes);
  assert.equal(tims.length, 2);
  assert.equal(tims[0].image, null);
  assert.deepEqual([tims[0].clut.x, tims[0].clut.y], [240, 2]);
  assert.deepEqual([tims[1].image.x, tims[1].image.y, tims[1].image.w, tims[1].image.h], [16, 8, 4, 2]);
});
