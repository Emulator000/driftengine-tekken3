/** The paint atlas's uploads: a slot let go is sent a texel a GPU can copy from. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

/* A canvas as the atlas uses one: its context made on asking. */
globalThis.OffscreenCanvas ??= class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = null;
  }
  getContext() {
    return (this.context ??= { clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} });
  }
};

const { PaintAtlas } = await import('../src/present/2d/atlas.ts');

/** A sprite pass that, as WebGPU's copy does, refuses a canvas no context was ever made on. */
function pass() {
  const sent = [];
  return {
    sent,
    setTexture(slot, canvas) {
      if (canvas.context === null) throw new Error(`slot ${slot}: a canvas without a rendering context`);
      sent.push(slot);
    },
    updateTexture() {},
  };
}

test('a resized atlas sends the slots it let go a texel the GPU can copy', () => {
  const gpu = pass();
  const atlas = new PaintAtlas([gpu], 256);
  assert.ok(atlas.picture('a', 40, 20, () => {}));
  assert.ok(atlas.picture('b', 300, 20, () => {}));
  atlas.upload();
  const slots = [...gpu.sent];
  assert.ok(slots.length > 0);
  /* A new window: the atlas emptied, every tile's slot let go. */
  atlas.resize(512);
  gpu.sent.length = 0;
  assert.doesNotThrow(() => atlas.upload());
  assert.deepEqual([...gpu.sent].sort(), [...slots].sort());
  gpu.sent.length = 0;
  atlas.upload();
  assert.deepEqual(gpu.sent, [], 'a slot is let go once');
});
