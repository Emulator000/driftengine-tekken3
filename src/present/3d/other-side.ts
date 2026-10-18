/**
 * The fight seen from the other side of the fighters' line, as an online match shows it to the
 * player whose side is the other one's: the camera reflected across the upright plane through both
 * fighters, so each stands where the other stood in the picture, the stage behind them its far side,
 * and nothing drawn mirrored (the picture's across turned back, a camera like any other).
 */

/** The game's camera as the scenery's layout reads it: its eye (the game's millimetres), its yaw and its pitch (4096ths of a turn). */
export interface DrawnCamera {
  readonly eye: readonly number[];
  readonly yaw: number;
  readonly pitch: number;
}

const TURN = 4096;

/** The fighters' line across the floor (the game's x and z): a point on it and its unit direction; null where they stand at one place. */
function lineOf(a: readonly number[], b: readonly number[]): { readonly x: number; readonly z: number; readonly dx: number; readonly dz: number } | null {
  const [dx, dz] = [b[0]! - a[0]!, b[2]! - a[2]!];
  const length = Math.hypot(dx, dz);
  return length < 1 ? null : { x: a[0]!, z: a[2]!, dx: dx / length, dz: dz / length };
}

/** The game's camera seen from the other side: its eye reflected across the fighters' line, its yaw (which looks along minus its sine and its cosine) turned to look the same way across it. */
export function otherSideCamera(camera: DrawnCamera, a: readonly number[], b: readonly number[]): DrawnCamera {
  const line = lineOf(a, b);
  if (line === null) return camera;
  const [nx, nz] = [-line.dz, line.dx];
  const off = 2 * ((camera.eye[0]! - line.x) * nx + (camera.eye[2]! - line.z) * nz);
  const along = Math.round((Math.atan2(line.dz, line.dx) * TURN) / (2 * Math.PI));
  return { eye: [camera.eye[0]! - off * nx, camera.eye[1]!, camera.eye[2]! - off * nz], yaw: (2 * along - camera.yaw - TURN / 2) & (TURN - 1), pitch: camera.pitch };
}

/**
 * An engine view (world to camera, column-major; metres, y up, z toward the eye: the game's x, minus
 * its y, minus its z) seen from the other side, in place: the world reflected across the fighters'
 * upright plane, then the picture's across turned back.
 */
export function otherSideView(view: Float32Array, a: readonly number[], b: readonly number[]): void {
  const line = lineOf(a, b);
  if (line === null) return;
  /* The plane's normal and a point on it, in the engine's axes. */
  const n = [-line.dz, 0, -line.dx];
  const at = [line.x / 1000, 0, -line.z / 1000];
  const off = 2 * (at[0]! * n[0]! + at[2]! * n[2]!);
  /* The reflection: x less twice its reach along the normal; column-major. */
  const reflection = new Float32Array(16);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) reflection[col * 4 + row] = (row === col ? 1 : 0) - 2 * n[row]! * n[col]!;
    reflection[12 + col] = off * n[col]!;
  }
  reflection[15] = 1;
  const product = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += view[k * 4 + row]! * reflection[col * 4 + k]!;
      product[col * 4 + row] = sum;
    }
  }
  /* The picture's across turned back: the first row negated. */
  for (let col = 0; col < 4; col += 1) product[col * 4] = -product[col * 4]!;
  view.set(product);
}
