/** Which GPUs a phone draws the very low picture with, by the names browsers give them. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entryLevelGpu, fightQuality } from '../src/present/3d/quality.ts';

test('the smallest Malis, the Adreno 5xx and 600s to 610s, and PowerVR are entry-level parts', () => {
  for (const name of ['ANGLE (ARM, Mali-G57 MC1, OpenGL ES 3.2)', 'Mali-G57', 'Mali-G52 MC2', 'Mali-G31 MP2', 'Adreno (TM) 619', 'Adreno (TM) 610', 'Adreno (TM) 506', 'ANGLE (Qualcomm, Adreno (TM) 618, OpenGL ES 3.2)', 'PowerVR Rogue GE8320']) {
    assert.ok(entryLevelGpu(name), name);
  }
});

test('mid-range and flagship parts, desktops and unnamed parts are not', () => {
  for (const name of ['Mali-G68 MC4', 'Mali-G710 MC10', 'Mali-G615 MC6', 'Adreno (TM) 642L', 'Adreno (TM) 660', 'Adreno (TM) 740', 'arm valhall', 'qualcomm adreno-6xx', 'ANGLE (AMD, Vulkan 1.4 (AMD Radeon RX 9070 XT), radv)', 'Apple GPU', 'WebGPU', '']) {
    assert.ok(!entryLevelGpu(name), name);
  }
});

test('the very low picture has no pass after the scene, one pixel to the CSS pixel and a cap on its area', () => {
  const q = fightQuality('verylow');
  assert.equal(q.screenEffects, false);
  assert.equal(q.hdrScene, false);
  assert.equal(q.maxDevicePixelRatio, 1);
  assert.equal(q.maxDrawingBufferPixels, 640 * 480);
  assert.equal(fightQuality('low').screenEffects, true);
});
