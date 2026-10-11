/**
 * The picture's finishing, by the address's `quality`: `high` (the default, but on a phone) adds
 * the engine's ambient occlusion (the fighters set on the floor, the stage's corners) and bloom
 * (only what is brighter than white: the sparks and flashes) to the multisampled HDR scene; `low`
 * (a phone's default) is the scene multisampled only.
 */
import type { RenderQualityOptions } from '@driftengine/core';

const BASE: RenderQualityOptions = { outputTransform: 'srgb', screenEffects: true, hdrScene: true, maxDevicePixelRatio: 2, sceneSamples: 4 };

export function fightQuality(level: string | null): RenderQualityOptions {
  if (level === 'low') return BASE;
  return { ...BASE, ambientOcclusion: 0.55, ambientOcclusionRadius: 0.45, bloom: 0.35, bloomThreshold: 1 };
}
