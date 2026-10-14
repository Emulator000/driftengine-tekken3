/**
 * The sky over an arcade stage: the engine's sky at the hour the stage is set at (its sun by day,
 * low and warm at sunset, its moon and stars by night, clouds drifting), and before it the stage's
 * panorama where it has one, scrolled as the camera turns, its bottom on the horizon and its top
 * fading into the sky, which takes the panorama's own colour there. A stage under a roof has none.
 */
import { srgbColor, type Camera, type Environment, type RendererApi, type SkyColors } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { FightState } from '../../../sim/fight/state.ts';
import type { ArcadePanoramaFiles } from '../fight-view.ts';

type Hour = 'day' | 'sunset' | 'night' | 'overcast';

/** The hour each arcade stage is set at, by its own look; null for one under a roof. */
const HOURS: readonly (Hour | null)[] = ['sunset', 'day', 'day', 'night', 'day', 'overcast', null, 'sunset', 'day', 'night', 'day', 'day', 'overcast', 'day'];

/** Each hour's sky (sRGB), and where its sun or moon stands: degrees above the horizon and round from ahead. */
const LOOKS: Record<Hour, { top: readonly number[]; horizon: readonly number[]; deep: readonly number[]; sun: readonly number[]; moon: readonly number[]; night: number; elevation: number; azimuth: number }> = {
  day: { top: [0.18, 0.36, 0.78], horizon: [0.62, 0.74, 0.9], deep: [0.3, 0.34, 0.4], sun: [2, 1.9, 1.7], moon: [0, 0, 0], night: 0, elevation: 16, azimuth: 25 },
  sunset: { top: [0.12, 0.16, 0.32], horizon: [0.9, 0.5, 0.3], deep: [0.2, 0.15, 0.15], sun: [1.6, 0.8, 0.4], moon: [0, 0, 0], night: 0, elevation: 4, azimuth: -20 },
  night: { top: [0.004, 0.006, 0.016], horizon: [0.02, 0.03, 0.06], deep: [0.01, 0.012, 0.02], sun: [0, 0, 0], moon: [0.9, 0.92, 1], night: 1, elevation: 18, azimuth: -30 },
  overcast: { top: [0.42, 0.45, 0.5], horizon: [0.6, 0.62, 0.65], deep: [0.3, 0.31, 0.33], sun: [0, 0, 0], moon: [0, 0, 0], night: 0, elevation: 30, azimuth: 0 },
};

/** The picture's lines; how far ahead the point the panorama's bottom stands on lies (m). */
const LINES = 480;
const HORIZON_AHEAD = 300;
/** How far the clouds drift a second (m). */
const DRIFT = [1.5, 0.6] as const;

const direction = (elevation: number, azimuth: number): [number, number, number] => {
  const e = (elevation * Math.PI) / 180;
  const a = (azimuth * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

/** Whether an arcade stage is drawn under a sky. */
export const arcadeSkyOver = (stage: number): boolean => (HOURS[stage] ?? null) !== null;

export class ArcadeSky {
  private readonly renderer: RendererApi;
  private readonly sky: SkyColors;
  private readonly panorama: { pass: SpritePass; handle: number; width: number; height: number; horizon: number } | null;
  private readonly transform = new Float32Array(6);

  /** `panorama` the stage's, where it has one. */
  constructor(renderer: RendererApi, stage: number, panorama: ArcadePanoramaFiles | null) {
    this.renderer = renderer;
    const look = LOOKS[HOURS[stage] ?? 'day'];
    const top = panorama === null ? null : panorama.top.map((c) => c / 255);
    const bottom = panorama === null ? null : panorama.bottom.map((c) => c / 255);
    const colour = (rgb: readonly number[]): [number, number, number] => srgbColor(rgb[0]!, rgb[1]!, rgb[2]!) as [number, number, number];
    const moon = direction(look.elevation, look.azimuth);
    this.sky = {
      top: colour(top ?? look.top),
      horizon: colour(top ?? look.horizon),
      deep: colour(bottom ?? look.deep),
      sunDir: look.night > 0 ? [-moon[0], -moon[1], -moon[2]] : direction(look.elevation, look.azimuth),
      sunColor: [look.sun[0]!, look.sun[1]!, look.sun[2]!],
      sunAngularRadius: 0.02,
      moonDir: look.night > 0 ? moon : [0, -1, 0],
      moonColor: [look.moon[0]!, look.moon[1]!, look.moon[2]!],
      moonAngularRadius: 0.03,
      moonPhase: 0.5,
      nightFactor: look.night,
      cloudOffsetX: 0,
      cloudOffsetZ: 0,
    };
    if (panorama === null) {
      this.panorama = null;
      return;
    }
    const pass = createSpritePass({ label: 'arcade panorama', capacity: 8, slots: 1 });
    pass.setTexture(0, panorama.picture, { colorSpace: 'srgb', filter: 'linear' });
    this.panorama = { pass, handle: renderer.registerPass(pass), width: panorama.width, height: panorama.height, horizon: panorama.horizon };
  }

  /**
   * The sky behind everything, then the panorama, at the start of the mesh pass: `camera` the
   * fight's, `aspect` the picture's, `sceneryYaw` the scenery's turn (4096ths), which the
   * panorama turns with.
   */
  draw(state: FightState, camera: Camera, env: Environment, aspect: number, sceneryYaw: number): void {
    const seconds = state.frameCount / 60;
    this.sky.cloudOffsetX = seconds * DRIFT[0];
    this.sky.cloudOffsetZ = seconds * DRIFT[1];
    this.renderer.drawSky(camera, this.sky, env);
    const panorama = this.panorama;
    if (panorama === null) return;
    /* The point far ahead on the floor, whose height on the picture the panorama's horizon takes. */
    const m = camera.viewProjection;
    const [px, , pz] = camera.position;
    const [fx, , fz] = camera.forward;
    const heading = Math.atan2(fx!, -fz!);
    const x = px! + Math.sin(heading) * HORIZON_AHEAD;
    const z = pz! - Math.cos(heading) * HORIZON_AHEAD;
    const w = m[3]! * x + m[15]! + m[11]! * z;
    const ndcY = (m[1]! * x + m[13]! + m[9]! * z) / w;
    const horizon = ((1 - ndcY) / 2) * LINES;
    const half = (LINES / 2) * aspect;
    /*
     * It turns past as fast as the scenery does: the picture's lines a radian at its middle, from
     * the camera's projection, a whole number of copies a turn (each copy sized to fill its share,
     * so the turn ends where it began), counted from the camera's heading in the scenery's frame.
     */
    const perTurn = 2 * Math.PI * (LINES / 2) * camera.projection[5]!;
    const copies = Math.max(1, Math.round(perTurn / panorama.width));
    const span = perTurn / copies;
    const tall = (panorama.height * span) / panorama.width;
    const angle = (-sceneryYaw * 2 * Math.PI) / 4096;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const yaw = Math.atan2(c * fx! + s * fz!, -(-s * fx! + c * fz!));
    let left = ((yaw / (2 * Math.PI)) * perTurn) % span;
    if (left < 0) left += span;
    this.transform.set([1 / half, 0, 0, -2 / LINES, -1, 1]);
    const pass = panorama.pass;
    pass.setTransform(this.transform);
    pass.reset();
    const y = horizon - tall * panorama.horizon;
    for (let x0 = -left; x0 < 2 * half; x0 += span) drawSprite(pass.batch, 0, { x: x0, y, w: span, h: tall }, { u0: 0, v0: 0, u1: 1, v1: 1 }, null);
    this.renderer.drawPass(panorama.handle);
  }
}
