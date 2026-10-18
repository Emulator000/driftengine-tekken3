/**
 * The arena's state each frame: the view the frame draws with, whether the ground shows, and the
 * scenery's turn. The scenery stands at the fighters' midpoint, turned by a yaw that follows the
 * camera's sideways slides, so the fight never reaches its edge; the fight keeps the roots of the
 * last four frames for when the camera holds on a spin. Where the scenery and the ground are laid
 * is the presentation's.
 */
import { angle4096, cosine, sine } from '../math/angles.ts';
import { viewMatrix } from './camera.ts';
import type { FightData, FightState } from './state.ts';
import { wallsOn } from './walls.ts';

/** The view from the drawn camera and, while the view looks above the horizon, the ground shown. */
export function layArena(state: FightState, data: FightData): void {
  if (state.nothingDrawn !== 0) return;
  viewMatrix(data, state.camera.drawn, state.view);
  state.groundShown = 0 < sine(data.math, state.camera.drawn.pitch + 0xef) ? 1 : 0;
}

/**
 * How far the scenery turns this frame: when the camera has not turned, by the angle its last look
 * point has slid to, a 24th of it and at most 0xaa; otherwise, and before the round's flow starts,
 * not at all.
 */
function sceneryTurn(state: FightState, data: Pick<FightData, 'math'>): number {
  const scenery = state.scenery;
  const drawn = state.camera.drawn;
  const [lastX, lastZ] = scenery.look as [number, number];
  const camX = drawn.eye[0]!;
  const camZ = drawn.eye[2]!;
  const seen = angle4096(lastX - camX, lastZ - camZ, data.math);
  const yaw = drawn.yaw & 0xfff;
  scenery.yawBefore = scenery.lastYaw & 0xfff;
  scenery.lastYaw = yaw;
  scenery.look[0] = (sine(data.math, -yaw) + camX) | 0;
  scenery.look[1] = (cosine(data.math, -yaw) + camZ) | 0;
  const slid = (seen - 0x400) & 0xfff;
  if (state.round.flow === 0) return 0;
  let turned = (((scenery.yawBefore & 0xffff) << 4) - ((scenery.lastYaw & 0xffff) << 4)) | 0;
  if (turned << 16 < 0) turned = -turned;
  if (!((turned << 16) >> 16 < 0x11)) return 0;
  const off = (((slid << 4) - (scenery.lastYaw << 4)) << 16) >> 16;
  if (off >= 0) {
    const step = Math.trunc(off / 24);
    return ((step << 16) >> 16 < 0xab ? step : 0xaa) & 0xfff;
  }
  const step = Math.trunc((((yaw - slid) << 4) & 0xffff) / 24);
  return (step < 0xab ? -step : -0xaa) & 0xfff;
}

/** The fighters' roots kept for the last four frames, and the scenery's yaw stepped (held unturned while the remake's walls stand, the stage fixed in place). */
export function stepScenery(state: FightState, data: Pick<FightData, 'math'>): void {
  if (state.nothingDrawn !== 0) return;
  const scenery = state.scenery;
  scenery.samples = (scenery.samples + 1) >>> 0;
  const i = scenery.samples & 3;
  [0, 1].forEach((k) => {
    const root = state.fighters[k]!.skeleton.base.translation;
    scenery.roots[k]![i]!.x = root[0]!;
    scenery.roots[k]![i]!.z = root[2]!;
  });
  const turn = sceneryTurn(state, data);
  if (!wallsOn(state)) scenery.yaw = (scenery.yaw + turn) & 0xfff;
}
