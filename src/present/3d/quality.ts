/**
 * The picture's finishing, by quality: `high` (the default, but on a phone) adds the engine's
 * ambient occlusion (the fighters set on the floor, the stage's corners) and bloom (only what is
 * brighter than white: the sparks and flashes) to the multisampled HDR scene; `low` (a phone's
 * default) is the scene multisampled only; `verylow` (a phone with an entry-level GPU) draws the
 * scene straight to the screen with no pass after it, at one pixel to the CSS pixel and no more
 * pixels than a 640 by 480 picture, four times the console's.
 */
import type { RenderQualityOptions } from '@driftengine/core';

export type Quality = 'high' | 'low' | 'verylow';

const QUALITIES: readonly string[] = ['high', 'low', 'verylow'];

export function isQuality(name: string | null): name is Quality {
  return name !== null && QUALITIES.includes(name);
}

/**
 * The GPUs a phone draws the very low picture with, by the name the browser gives the part: the
 * smallest Malis (G31, G51, G52, G57), the Adreno 5xx and 600s to 610s, and PowerVR. Narrower than
 * the engine's weak parts, which take in the Adreno 650 and 660 of flagships.
 */
const ENTRY_LEVEL: readonly RegExp[] = [/mali-g(?:31|51|52|57)\b/, /adreno\D*(?:5\d\d|6[01]\d)\b/, /powervr/];

/** Whether a GPU named `renderer` (`describeGpu`) is an entry-level part. */
export function entryLevelGpu(renderer: string): boolean {
  const name = renderer.toLowerCase();
  return ENTRY_LEVEL.some((pattern) => pattern.test(name));
}

/** The most pixels a very low picture has. */
const VERY_LOW_PIXELS = 640 * 480;

const BASE: RenderQualityOptions = { outputTransform: 'srgb', screenEffects: true, hdrScene: true, maxDevicePixelRatio: 2, sceneSamples: 4 };

export function fightQuality(level: Quality): RenderQualityOptions {
  if (level === 'verylow') return { ...BASE, screenEffects: false, hdrScene: false, maxDevicePixelRatio: 1, maxDrawingBufferPixels: VERY_LOW_PIXELS };
  if (level === 'low') return BASE;
  return { ...BASE, ambientOcclusion: 0.55, ambientOcclusionRadius: 0.45, bloom: 0.35, bloomThreshold: 1 };
}
