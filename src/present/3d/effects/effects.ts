/**
 * The fight's effects drawn with the engine's particles, sprites and lights. Each frame, before the
 * scene, the simulation's records become pieces (`effect-pieces.ts`) and the pieces particles,
 * shapes and lights (`effect-looks.ts`); the lights join the fight's environment, so a spark lights
 * the fighters and the floor in its colour. After the opaque scene the batches draw: the dust and
 * breath blended, then the light added onto the picture past white for the bloom, its streaks stretched
 * along their travel, its shapes from a sheet painted in code; the Mishimas' lightning as the
 * engine's bolts.
 */
import { createPointLightBuffer, selectPointLights, type BoltHandle, type Camera, type Environment, type ParticleHandle, type PointLightBuffer, type PointLightSource, type RendererApi } from '@driftengine/core';
import type { FightData, FightState } from '../../../sim/fight/state.ts';
import { effectPieces } from './effect-pieces.ts';
import { effectBuffers, fillEffects, LIGHTNING, STRETCH, type ViewBasis } from './effect-looks.ts';
import { SHAPE_CELLS, shapeSheet } from './flipbooks.ts';

/** How far past white a streak's core goes: little, so a streak keeps its colour. */
const CORE_GAIN = 0.6;
/** Metres each particle is drawn toward the eye, so an effect inside a body shows in front of it. */
const TOWARD_EYE = 0.4;
/** A cell of the shapes' sheet, in pixels. */
const SHAPE_CELL = 256;

export class Effects {
  private readonly renderer: RendererApi;
  private readonly buffers = effectBuffers();
  private readonly streaks: ParticleHandle;
  private readonly glows: ParticleHandle;
  private readonly shapes: ParticleHandle;
  private readonly puffs: ParticleHandle;
  private readonly bolts: BoltHandle;
  /** The lightning's colours as the bolt batch takes them. */
  private readonly boltCore: [number, number, number] = [...LIGHTNING.core];
  private readonly boltEdge: [number, number, number] = [...LIGHTNING.edge];
  private readonly sources: PointLightSource[];
  private readonly chosen: PointLightBuffer;

  constructor(renderer: RendererApi) {
    this.renderer = renderer;
    const { streaks, glows, shapes, puffs, lights } = this.buffers;
    this.streaks = renderer.createParticles(streaks.capacity, { material: 'spark', blend: 'additive', stretchSec: STRETCH, coreGain: CORE_GAIN, cameraOffset: TOWARD_EYE });
    this.glows = renderer.createParticles(glows.capacity, { material: 'mote', blend: 'additive', cameraOffset: TOWARD_EYE });
    const sheet = renderer.createSurfaceTexture(shapeSheet(SHAPE_CELL), { colorSpace: 'linear', filter: 'linear', mipmap: true, wrap: 'clamp' });
    this.shapes = renderer.createParticles(shapes.capacity, { material: 'sprite', blend: 'additive', texture: sheet, cells: SHAPE_CELLS, cameraOffset: TOWARD_EYE });
    this.puffs = renderer.createParticles(puffs.capacity, { material: 'sprite', blend: 'alpha', texture: sheet, cells: SHAPE_CELLS, softDepth: 0.15, sort: true });
    this.bolts = renderer.createBolts(this.buffers.bolts.capacity, 'lightning');
    this.sources = Array.from({ length: lights.capacity }, () => ({ x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, radius: 1, flicker: 0, shadowNear: 0.2, sourceRadius: 0.05 }));
    this.chosen = createPointLightBuffer(renderer.shadedLights);
  }

  /** This frame's effects laid out from the state, and their lights put into `env`; before the scene. */
  prepare(state: FightState, data: FightData, env: Environment, view: Float32Array, eye: ArrayLike<number>): void {
    const basis: ViewBasis = { right: [view[0]!, view[4]!, view[8]!], up: [view[1]!, view[5]!, view[9]!] };
    const out = this.buffers;
    fillEffects(effectPieces(state, data), basis, out);
    const lights = out.lights;
    const live = this.sources.slice(0, lights.count);
    live.forEach((source, i) => {
      source.x = lights.positions[i * 3]!;
      source.y = lights.positions[i * 3 + 1]!;
      source.z = lights.positions[i * 3 + 2]!;
      source.r = lights.colors[i * 3]!;
      source.g = lights.colors[i * 3 + 1]!;
      source.b = lights.colors[i * 3 + 2]!;
      source.radius = lights.radii[i]!;
    });
    const chosen = this.chosen;
    selectPointLights(live, eye[0]!, eye[1]!, eye[2]!, chosen);
    env.lightCount = chosen.count;
    env.lightPositions = chosen.positions;
    env.lightColors = chosen.colors;
    env.lightRadii = chosen.radii;
    env.lightSourceRadii = chosen.sourceRadii;
    env.lightWeights = chosen.weights;
    env.lightDirections = chosen.directions;
    env.lightConeCos = chosen.coneCos;
    env.lightIesProfiles = chosen.iesProfiles;
    env.activeLightWorldIndices = chosen.sourceIndex;
  }

  /** The effects laid out by `prepare`, after the opaque scene. */
  draw(camera: Camera, env: Environment, seconds: number): void {
    const out = this.buffers;
    const r = this.renderer;
    if (out.puffs.count > 0) r.drawParticles(this.puffs, out.puffs, camera, env, seconds);
    if (out.shapes.count > 0) r.drawParticles(this.shapes, out.shapes, camera, env, seconds);
    if (out.glows.count > 0) r.drawParticles(this.glows, out.glows, camera, env, seconds);
    if (out.streaks.count > 0) r.drawParticles(this.streaks, out.streaks, camera, env, seconds);
    if (out.bolts.count > 0) r.drawBolts(this.bolts, out.bolts, camera, env, seconds, this.boltCore, this.boltEdge, LIGHTNING.width, LIGHTNING.coreGain, LIGHTNING.leastWidth);
  }
}
