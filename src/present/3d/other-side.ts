/**
 * The fight seen from the other side of the stage, as an online match shows it to the player whose
 * side is the other one's: the game's camera turned half round the upright line through the point it
 * looks at (its focus, as the game finds one), so it moves as the game's camera moves and turns as it
 * turns, each fighter standing where the other stood, the stage behind them its far side, and nothing
 * drawn mirrored. A round's closing (the winner's pose, the finishing shot, framed on the fighters'
 * fronts) is shown as the game frames it, the picture changing sides only where its camera cuts.
 */

import { Flow } from '../../sim/fight/flow.ts';

/** The game's camera as the scenery's layout reads it: its eye (the game's millimetres), its yaw and its pitch (4096ths of a turn). */
export interface DrawnCamera {
  readonly eye: readonly number[];
  readonly yaw: number;
  readonly pitch: number;
}

const TURN = 4096;
/** A cut: the eye moved more than a metre (the game's millimetres), or the camera turned more than 20 degrees. */
const CUT_MOVE = 1000;
const CUT_TURN = (20 / 360) * TURN;

/** Whether the game's camera cut between two frames, rather than moved. */
export function cameraCut(last: DrawnCamera, now: DrawnCamera): boolean {
  const moved = Math.hypot(now.eye[0]! - last.eye[0]!, now.eye[1]! - last.eye[1]!, now.eye[2]! - last.eye[2]!);
  const turned = Math.abs(((((now.yaw - last.yaw) % TURN) + TURN + TURN / 2) % TURN) - TURN / 2);
  return moved > CUT_MOVE || turned > CUT_TURN;
}

/**
 * Whether each frame of a fight seen from the other side shows the game's own camera rather than
 * turned half round: a round's closing from its first cut on (a knockout's closing cuts to the
 * winner's pose), until the next cut outside it (the next round's opening). A closing on the fight's
 * own camera, which never cuts (a time up's), stays turned.
 */
export class ClosingShots {
  private own = false;
  private last: DrawnCamera | null = null;

  /** This frame, from the game's camera and the round's flow. */
  shows(camera: DrawnCamera, flow: number): boolean {
    if (this.last !== null && cameraCut(this.last, camera)) this.own = flow === Flow.CLOSING_START || flow === Flow.CLOSING;
    this.last = { eye: [...camera.eye], yaw: camera.yaw, pitch: camera.pitch };
    return this.own;
  }
}

/**
 * Where the camera looks, across the floor (the game's x and z), as the game finds a camera's focus:
 * along its view at the mean of its eye's distances to the two points it tracks (the fighters'
 * heads). Its yaw looks along minus its sine and its cosine.
 */
export function focusOf(camera: DrawnCamera, tracked: readonly { readonly at: readonly number[] }[]): [number, number] {
  const eye = camera.eye;
  const distance = (at: readonly number[]): number => Math.hypot(at[0]! - eye[0]!, at[1]! - eye[1]!, at[2]! - eye[2]!);
  const reach = ((distance(tracked[0]!.at) + distance(tracked[1]!.at)) / 2) * Math.cos((camera.pitch * 2 * Math.PI) / TURN);
  const yaw = (camera.yaw * 2 * Math.PI) / TURN;
  return [eye[0]! - Math.sin(yaw) * reach, eye[2]! + Math.cos(yaw) * reach];
}

/** The game's camera turned half round its focus (`focusOf`): its eye across it at its height, its yaw half a turn on, its pitch kept. */
export function otherSideCamera(camera: DrawnCamera, focus: readonly [number, number]): DrawnCamera {
  const eye = camera.eye;
  return { eye: [2 * focus[0] - eye[0]!, eye[1]!, 2 * focus[1] - eye[2]!], yaw: (camera.yaw + TURN / 2) & (TURN - 1), pitch: camera.pitch };
}

/**
 * An engine view (world to camera, column-major; metres, y up, z toward the eye: the game's x, minus
 * its y, minus its z) turned half round the upright line through the focus, in place: the world
 * turned about that line (x and z through it negated), then seen by the view as it was.
 */
export function otherSideView(view: Float32Array, focus: readonly [number, number]): void {
  const [x, z] = [focus[0] / 1000, -focus[1] / 1000];
  for (let row = 0; row < 4; row += 1) {
    const [across, deep] = [view[row]!, view[8 + row]!];
    view[12 + row] = view[12 + row]! + 2 * x * across + 2 * z * deep;
    view[row] = -across;
    view[8 + row] = -deep;
  }
}
