/**
 * A stage's floor as the remaster draws it, from what the importer made: its picture redrawn (or the
 * stage's own) with normal and ORM maps, wet as the stage's look asks (water in its joints, a sheen
 * elsewhere, its normal map faint where water lies), a see-through floor (a grating) drawn from the
 * game's own enlarged with its bars bevelled and of steel, and its heights for the tiles to sink by.
 */
import type { RendererApi, SurfaceTextureHandle } from '@driftengine/core';
import type { FloorLayout, FloorLook } from './ground.ts';
import { gratingMaps, heightsOf, macroRelief, originalFloor, pixelsOf, reliefMaps, wetMaps, type StageLook } from './looks.ts';
import { FINE_CUTS } from './relief.ts';

/** A floor redrawn by the importer: its atlas, its maps, and where the ground's regions went. */
export interface RedrawnFloor {
  readonly texture: ImageBitmap;
  readonly maps: { readonly normal: ImageBitmap | null; readonly orm: ImageBitmap | null; readonly height?: ImageBitmap | null } | null;
  readonly layout: FloorLayout;
}

const COLOUR = { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'clamp', anisotropy: 16 } as const;
const DATA = { colorSpace: 'linear', filter: 'linear', mipmap: true, wrap: 'clamp', anisotropy: 16 } as const;
/** How much of a redrawn floor's texels are clear for it to be see-through (a few at a region's edge take in the atlas round it). */
const SEE_THROUGH = 0.02;

/**
 * The floor's look: `texture` the stage's own atlas (`atlas` its size as the ground's cells count
 * it), `floor` the redrawn one where the importer made it, `look` the stage's.
 */
export function floorLookOf(renderer: RendererApi, texture: ImageBitmap, atlas: { readonly width: number }, floor: RedrawnFloor | undefined, look: StageLook): FloorLook {
  const own = look.floor;
  const wet = own.reflectivity === 0 ? null : { reflectivity: own.reflectivity, roughnessScale: 1, specular: own.metal === undefined ? 0.5 : 0.04, grain: own.grain ?? 1 };
  const textures = (maps: { normal: ImageData; orm: ImageData }): { normal: SurfaceTextureHandle; orm: SurfaceTextureHandle } => ({
    normal: renderer.createSurfaceTexture(maps.normal, DATA),
    orm: renderer.createSurfaceTexture(maps.orm, DATA),
  });
  if (floor === undefined) return { texture: renderer.createSurfaceTexture(texture, COLOUR), ...textures(reliefMaps(texture, own)), layout: null, width: texture.width, height: texture.height, wet, seeThrough: true };
  const { cell, columns, regions, size } = floor.layout;
  /* The game's own floor laid as the redrawn one is, and how much of it is clear. */
  const original = originalFloor(texture, texture.width / atlas.width, regions, size, cell, columns);
  let holes = 0;
  regions.forEach((_, k) => {
    for (let y = 0; y < cell; y += 1) {
      const row = (Math.floor(k / columns) * cell + y) * original.width + (k % columns) * cell;
      for (let x = 0; x < cell; x += 1) if (original.data[(row + x) * 4 + 3]! < 128) holes += 1;
    }
  });
  const seeThrough = holes > regions.length * cell * cell * SEE_THROUGH;
  const base = { layout: floor.layout, width: floor.texture.width, height: floor.texture.height, wet, seeThrough };
  if (seeThrough) {
    /* Its colours the redrawn floor's, enlarged with their grain; its holes the game's own. */
    const drawn = pixelsOf(floor.texture);
    if (drawn.width === original.width && drawn.height === original.height) {
      for (let i = 0; i < original.data.length; i += 4) original.data.set(drawn.data.subarray(i, i + 3), i);
    }
    const grating = gratingMaps(original, Math.max(2, Math.round(cell / 256)), own.metal ?? 0.6, own.roughness);
    return { texture: renderer.createSurfaceTexture(grating.albedo, COLOUR), ...textures(grating), ...base, relief: null };
  }
  const relief = floor.maps?.height == null || own.depth === 0 ? null : { ...heightsOf(floor.maps.height, cell, Math.max(1, Math.round(cell / FINE_CUTS / 4)), Math.round(cell / 18)), depth: own.depth };
  const picture = renderer.createSurfaceTexture(floor.texture, COLOUR);
  const maps = floor.maps;
  if (maps?.normal == null || maps.orm == null) {
    return { texture: picture, normal: maps?.normal == null ? null : renderer.createSurfaceTexture(maps.normal, DATA), orm: maps?.orm == null ? null : renderer.createSurfaceTexture(maps.orm, DATA), ...base, relief };
  }
  const normal = pixelsOf(maps.normal);
  const orm = pixelsOf(maps.orm);
  if (wet !== null) {
    /* A picture enlarged rather than drawn anew has its stones' relief from the game's own floor. */
    if (floor.layout.drawn === undefined || floor.layout.drawn === false) macroRelief(original, normal, orm, cell, own.relief * 1.2);
    wetMaps(normal, orm, cell, own);
  }
  return { texture: picture, ...textures({ normal, orm }), ...base, relief };
}

/**
 * The floor's colour against its texture's: the stage's own light undone (so the floor keeps its
 * picture's colours where nothing shades it), at most so much (a low sun leaves it dim, and stone
 * turned toward it is not burnt white), times the look's albedo and tint.
 */
export function floorTint(look: StageLook): [number, number, number] {
  const up = Math.max(0, look.sun[1] / Math.hypot(...look.sun));
  return [0, 1, 2].map((c) => ((look.floor.tint?.[c] ?? 1) * look.floor.albedo) / Math.max(0.7, look.ambient[c]! + look.sunColour[c]! * up)) as [number, number, number];
}
