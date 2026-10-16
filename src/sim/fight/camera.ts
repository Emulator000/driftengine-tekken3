/**
 * The fight's camera: five slots blended into the view the frame draws (`FightCamera`); the follow
 * camera that keeps both fighters framed; the round's opening sweep; the shots some moves and
 * throws play, built in or scripted in the movesets; the scenes a counted hit calls for; the
 * knockout cameras and the round's finishing shot; the replay's camera; and the view matrix.
 *
 * Slots hold 18-bit angles (0x40000 a turn); the drawn view holds 12-bit ones. Integer arithmetic
 * follows the original's: products kept to 32 bits, shifts that round toward zero where the
 * compiler divided, halfword fields cut to 16 bits when written.
 */
import type { CameraScript, ScriptSegment, ShotChoice } from '../data/camera.ts';
import type { Moveset } from '../data/moveset.ts';
import { angle4096, cosine, sine } from '../math/angles.ts';
import { cpuDiv, div, s16 } from '../math/integers.ts';
import { multiply, multiplyInto, type Matrix } from '../math/matrix.ts';
import { nextRandom, randomBelow } from '../math/random.ts';
import { isqrt, tableRoot } from '../math/roots.ts';
import { keyedAt } from './motion.ts';
import { moveAt, sameMove } from './moves.ts';
import { Mode, type CameraPlace, type CameraView, type FightData, type Fighter, type FightState, type ScriptRef, type ShotRef, type Tracked } from './state.ts';

/** The slots: following, shots and the replay, scripts and the opening, the blend, a held view. */
const FOLLOW = 0;
const SHOT = 1;
const SCRIPT = 2;
const BLENDED = 3;
const HELD = 4;
/** The step that ends a camera shake's list. */
const SHAKE_END = -0x80;
/** The follow camera's distance, and the progress a script runs to. */
const FOLLOW_DISTANCE = 0x158d;
const SCRIPT_END = 0x140;
const ATTRACT = 6;
/** The screen distance an attract intro's scripts are made for. */
const INTRO_SCREEN = 0x1c2;
const TEKKEN_BALL = 7;

/** A place as the code passes one by value: x, y, z, pitch, yaw, screen distance. */
type Place = number[];

const mul = Math.imul;
/** An 18-bit angle as a 12-bit table index, rounding toward zero as the shifts do. */
const index18 = (a: number): number => ((a < 0 ? a + 0x3f : a) >> 6) & 0xfff;
/** A 4.12 product back to an integer, rounding toward zero. */
const q12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;
/** A right shift rounding toward zero, as the compiler divides by powers of two. */
const shr = (v: number, n: number): number => (v < 0 ? v + (1 << n) - 1 : v) >> n;
/** An 18-bit angle difference, signed. */
const wrap18 = (v: number): number => (v & 0x20000 ? v | 0xfffc0000 : v & 0x3ffff);

interface Camera {
  readonly state: FightState;
  readonly data: FightData;
}

const sin = (c: Camera, i: number): number => sine(c.data.math, i);
const trackedPair = (c: Camera): [Tracked, Tracked] => [c.state.camera.tracked[0]!, c.state.camera.tracked[1]!];
const cos = (c: Camera, i: number): number => cosine(c.data.math, i);
const angle = (c: Camera, x: number, z: number): number => angle4096(x, z, c.data.math);

function moveOf(c: Camera, f: Fighter) {
  if (f.move === null) throw new Error(`fighter in slot ${f.slot} plays no move`);
  return moveAt(c.data, f.move);
}

/** A move's camera byte: which shots it calls for; none from a fighter on no move (an intro's sides as it sets up, still on an id their moveset lacks). */
const cameraByte = (c: Camera, f: Fighter): number => (f.move === null ? 0 : moveOf(c, f).hitFlags & 0xff);

function readSlot(c: Camera, i: number): Place {
  const slot = c.state.camera.slots[i]!;
  return [slot.eye[0]!, slot.eye[1]!, slot.eye[2]!, slot.pitch, slot.yaw, slot.screen];
}

function writeSlot(c: Camera, place: Place, i: number): void {
  const slot = c.state.camera.slots[i]!;
  for (let k = 0; k < 3; k += 1) slot.eye[k] = place[k]! | 0;
  slot.pitch = place[3]! | 0;
  slot.yaw = place[4]! | 0;
  slot.screen = place[5]! | 0;
}

/** Back to following: full weight on slot 0, no shot, nothing counting. */
function resetCamera(c: Camera): void {
  const cam = c.state.camera;
  cam.drawn.pitch = 0;
  cam.drawn.yaw = 0;
  cam.drawn.roll = 0;
  cam.drawn.eye[0] = 0;
  cam.drawn.eye[1] = -0x4b0;
  cam.drawn.eye[2] = 0;
  cam.weights.fill(0);
  cam.lastWeights.fill(0);
  cam.weights[FOLLOW] = 0x1000;
  cam.state = 1;
  cam.countdown = -1;
  cam.watched = -1;
  cam.length = -1;
  cam.left = -1;
  cam.sceneLength = -1;
  cam.sceneLeft = -1;
  cam.lockedOn = -1;
  cam.scriptRestart = 0;
  cam.following = 1;
  cam.opening.left = 0;
  const mode = c.state.mode;
  cam.shotsAllowed = mode < ATTRACT || Mode.TEKKEN_FORCE < mode ? 1 : 0;
}

/** The screen's distance, held to the arena's range. */
function setScreen(c: Camera, distance: number): void {
  const cam = c.state.camera;
  let h = cam.screenMin;
  if (cam.screenMin <= distance) {
    h = distance;
    if (cam.screenMax < distance) h = cam.screenMax;
  }
  c.state.screen.distance = h & 0xffff;
}

/** The default screen distance, 500. */
function resetScreen(c: Camera): void {
  const cam = c.state.camera;
  cam.screen = 500;
  cam.screenMin = 500;
  cam.screenMax = 500;
  cam.scaleScripts = 1;
  cam.arenaKind = 0;
  c.state.screen.distance = 500;
}

/** Draw from a slot, and keep it as the blend's. */
function useSlot(c: Camera, i: number): void {
  const place = readSlot(c, i);
  const drawn = c.state.camera.drawn;
  for (let k = 0; k < 3; k += 1) drawn.eye[k] = place[k]!;
  writeSlot(c, place, BLENDED);
  drawn.pitch = shr(place[3]!, 6);
  drawn.yaw = shr(place[4]!, 6);
  setScreen(c, place[5]!);
}

const holdSlot = (c: Camera, i: number): void => writeSlot(c, readSlot(c, i), HELD);

/**
 * The point a place looks at, as far along its view as the fighters are on average (both
 * distances take the first fighter's depth). Returns that distance.
 */
function focusOf(c: Camera, place: Place, out: number[]): number {
  const [x, y, z, pitch, yaw] = place as [number, number, number, number, number];
  const [first, second] = trackedPair(c);
  const p = index18(pitch);
  const sp = sin(c, p);
  const cp = cos(c, p);
  const t = index18(yaw + 0x10000);
  const st = sin(c, t);
  const ct = cos(c, t);
  const dz = first.at[2]! - z;
  const dz2 = mul(dz, dz);
  const da = isqrt((mul(first.at[0]! - x, first.at[0]! - x) + mul(first.at[1]! - y, first.at[1]! - y) + dz2) | 0);
  const db = isqrt((mul(second.at[0]! - x, second.at[0]! - x) + mul(second.at[1]! - y, second.at[1]! - y) + dz2) | 0);
  const d = ((da + db) >>> 1) | 0;
  out[0] = x + q12(mul(q12(mul(d, ct)), cp));
  out[1] = y + q12(mul(d, sp));
  out[2] = z + q12(mul(q12(mul(d, st)), cp));
  return d;
}

/** A place at one point looking at another, with a screen distance if positive. */
function lookAt(c: Camera, out: Place, from: readonly number[], to: readonly number[], distance: number): void {
  out[0] = from[0]!;
  out[1] = from[1]!;
  out[2] = from[2]!;
  const dx = to[0]! - from[0]!;
  const dz = to[2]! - from[2]!;
  out[3] = (angle(c, isqrt((mul(dx, dx) + mul(dz, dz)) | 0), to[1]! - from[1]!) << 16) >> 10;
  out[4] = (angle(c, dz, -dx) << 16) >> 10;
  if (0 < distance) out[5] = distance;
}

/**
 * Two places blended by weight (4.12 on the first): their focus points and distances mixed, their
 * angles turned the short way, and the eye set back along the blended view. Into the blend's slot
 * and the screen.
 */
function blendPlaces(c: Camera, a: Place, b: Place, weight: number): void {
  const rest = 0x1000 - weight;
  const fa = [0, 0, 0];
  const fb = [0, 0, 0];
  const da = focusOf(c, a, fa);
  const db = focusOf(c, b, fb);
  const d = q12((mul(da, weight) + mul(db, rest)) | 0);
  const fx = q12((mul(fa[0]!, weight) + mul(fb[0]!, rest)) | 0);
  const fy = q12((mul(fa[1]!, weight) + mul(fb[1]!, rest)) | 0);
  const fz = q12((mul(fa[2]!, weight) + mul(fb[2]!, rest)) | 0);
  const pitch = a[3]! + q12(mul(wrap18(b[3]! - a[3]!), rest));
  const yaw = a[4]! + q12(mul(wrap18(b[4]! - a[4]!), rest));
  const p = index18(pitch);
  const t = (shr(yaw, 6) + 0x400) & 0xfff;
  const x = fx - q12(mul(q12(mul(d, cos(c, t))), cos(c, p)));
  const y = fy - q12(mul(d, sin(c, p)));
  const z = fz - q12(mul(q12(mul(d, sin(c, t))), cos(c, p)));
  const distance = q12((mul(a[5]!, weight) + mul(b[5]!, rest)) | 0);
  const dx = fx - x;
  const dz = fz - z;
  const out = readSlot(c, BLENDED);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = (angle(c, isqrt((mul(dx, dx) + mul(dz, dz)) | 0), fy - y) << 16) >> 10;
  out[4] = (angle(c, dz, -dx) << 16) >> 10;
  if (0 < distance) out[5] = distance;
  writeSlot(c, out, BLENDED);
  useSlot(c, BLENDED);
  setScreen(c, distance);
}

/** The drawn view from the weighted slots: one alone, or two blended. */
function blend(c: Camera): void {
  const cam = c.state.camera;
  let mask = 0;
  for (let i = 0; i < 5; i += 1) if (0 < cam.weights[i]!) mask |= 1 << i;
  const w = cam.weights[FOLLOW]!;
  if (mask === 1) useSlot(c, FOLLOW);
  else if (mask === 2) useSlot(c, SHOT);
  else if (mask === 4) useSlot(c, SCRIPT);
  else if (mask === 3) blendPlaces(c, readSlot(c, FOLLOW), readSlot(c, SHOT), w);
  else if (mask === 5) blendPlaces(c, readSlot(c, FOLLOW), readSlot(c, SCRIPT), w);
  else if (mask === 0x10) useSlot(c, HELD);
  else if (mask === 0x11) blendPlaces(c, readSlot(c, FOLLOW), readSlot(c, HELD), div(sin(c, div(w, 2) - 0x400), 2) + 0x800);
  else resetCamera(c);
  for (let i = 0; i < 5; i += 1) cam.lastWeights[i] = cam.weights[i]!;
}

/** The fighter whose spinning sidestep (camera byte `S`) holds the camera, or -1. */
function lockedOn(c: Camera): number {
  const [a, b] = c.state.fighters;
  if (a.character === 4 && cameraByte(c, a) === 0x53) return 0;
  if (b.character === 4 && cameraByte(c, b) === 0x53) return 1;
  return -1;
}

/**
 * The fighter the camera holds on this frame (its spinning sidestep), or -1, as before the fight's
 * first field, when neither plays a move yet: the presentation stands the scenery by it.
 */
export const fighterLockedOn = (state: FightState, data: FightData): number =>
  state.fighters[0]!.move === null || state.fighters[1]!.move === null ? -1 : lockedOn({ state, data });

/**
 * Where the camera tracks each fighter this frame. A fighter mid-throw, or in a move that asks
 * for it (bit 29 of its flags), is tracked by its root; its height is its head's less 0x122. The
 * locked-on fighter moves the camera only on odd frames.
 */
function track(c: Camera, a: Fighter, b: Fighter, still: number): void {
  const cam = c.state.camera;
  if (a.throwHold !== 0 || b.throwHold !== 0) still = 1;
  [a, b].forEach((f, i) => {
    const t = cam.tracked[i]!;
    const last = cam.lastTracked[i]!;
    for (let k = 0; k < 3; k += 1) last.at[k] = t.at[k]!;
    last.screenX = t.screenX;
    if (cam.lockedOn !== i || (f.frame & 1) !== 0) {
      const base = f.skeleton.base.translation;
      /* A side still on an id its moveset lacks (the attract intro's) asks for nothing: the stray bytes the game reads there leave bit 29 clear. */
      const flags = f.move === null ? 0 : moveOf(c, f).hitFlags;
      if (((flags >>> 29) & 1) === 0 && f.throwHold === 0 && still === 0) {
        t.at[0] = f.position[0]!;
        t.at[2] = f.position[2]!;
      } else {
        t.at[0] = base[0]!;
        t.at[2] = base[2]!;
      }
      t.screenX = f.screenX;
      t.at[1] = (f.skeleton.joints[2]!.world.translation[1]! - 0x122) | 0;
      if (f.moveId === 2 && f.character === 4) t.at[1] = -0x6b8;
    }
  });
  const [first, second] = trackedPair(c);
  if (first.at[0] === second.at[0] && first.at[2] === second.at[2]) {
    second.at[0] = (first.at[0]! + 1) | 0;
    second.at[2] = (first.at[2]! + 1) | 0;
    first.at[0] = (first.at[0]! - 1) | 0;
    first.at[2] = (first.at[2]! - 1) | 0;
  }
}

/** The fighters' line as a 12-bit angle, turned so the fighter further right on screen is on the right. */
function lineAngle(c: Camera, a: Fighter, b: Fighter): number {
  const [first, second] = trackedPair(c);
  let line = s16(angle(c, second.at[0]! - first.at[0]!, second.at[2]! - first.at[2]!) & 0xffff);
  if (b.screenX <= a.screenX) line = (line + 0x800) & 0xfff;
  return line;
}

/**
 * The yaw the follow camera wants: square to the fighters' line. Slot 0 swings toward it with some
 * inertia once off by more than an eighth of a turn, tilts up when far off, and some moves' camera
 * bytes (`'` to `*`) limit the swing.
 */
function followYaw(c: Camera, a: Fighter, b: Fighter, snap: number, slot: number): number {
  const cam = c.state.camera;
  let yaw = cam.slots[slot]!.yaw;
  const line = lineAngle(c, a, b);
  let off = wrap18(line * 0x40 - yaw);
  let sign = 0;
  let swing = 0;
  if (0 < off) sign = 1;
  else if (off < 0) {
    off = -off;
    sign = -1;
  }
  const f = cam.follow[slot]!;
  if (snap !== 0) {
    f.swing = 0;
    f.swingSpeed = 0;
    f.tilt = 0;
    f.tiltTarget = 0;
    f.tiltStep = 0;
    return line * 0x40;
  }
  if (slot !== FOLLOW || 0x1aaaa < off || c.state.distance < 200) return yaw;
  const own = cam.follow[FOLLOW]!;
  if (own.swinging === 0) {
    if (off < 0xe38) own.offFrames = 0;
    else own.offFrames += 1;
    if (0 < own.offFrames) {
      own.swinging = 1;
      own.offFrames = 0;
      own.swingSpeed = (own.swingSpeed + sign * 0x600) | 0;
    }
  } else if (own.swinging === 1) {
    if (off < 0x38e4) {
      own.swing = (own.swing - shr(mul(own.swing, 0xe), 7)) | 0;
      let speed = own.swingSpeed;
      speed = (speed - div(speed, 2) + sign * 0x300) | 0;
      own.swingSpeed = speed;
      let keep = false;
      if (off < 0xe39) {
        own.swingSpeed = (speed - div(speed, 2)) | 0;
        own.offFrames += 1;
        if (own.offFrames < 0x20) keep = true;
        else {
          own.swing = 0;
          own.swinging = 0;
        }
      }
      if (!keep) own.offFrames = 0;
    } else if (0 < sign) own.swingSpeed = (own.swingSpeed + 0x600) | 0;
    else if (sign < 0) own.swingSpeed = (own.swingSpeed - 0x600) | 0;
    own.swing = (own.swing + own.swingSpeed) | 0;
    const [first, second] = c.state.fighters;
    const ca = cameraByte(c, first);
    const cb = cameraByte(c, second);
    let range = -1;
    if (ca === 0x27 || cb === 0x27) range = 0x200;
    else if (ca === 0x28 || cb === 0x28) range = 0x180;
    else if (ca === 0x29 || cb === 0x29) range = 0x80;
    else if (ca === 0x2a || cb === 0x2a) range = 0x40;
    const offset = own.swing;
    if (range < 1) {
      if (0xddd0 < offset) {
        own.swing = 0xddd0;
        own.swingSpeed = (own.swingSpeed - 0x600) | 0;
      } else if (offset < -0xddd0) {
        own.swing = -0xddd0;
        own.swingSpeed = (own.swingSpeed + 0x600) | 0;
      }
    } else {
      const high = shr(range * 0xddd0, 8);
      const low = shr(range * -0xddd0, 8);
      if (high < offset) {
        own.swingSpeed = (own.swingSpeed - 0x600) | 0;
        own.swing = high;
      } else if (offset < low) {
        own.swingSpeed = (own.swingSpeed + 0x600) | 0;
        own.swing = low;
      }
    }
    swing = shr(own.swing, 6);
  } else throw new Error(`the follow camera's swing is in state ${own.swinging}`);

  if (off < 0x38e3) own.tiltTarget = 0;
  else {
    const t = div(mul(off - 0x38e3, 0x1000), 0xc71d);
    own.tiltTarget = q12(mul(sin(c, shr(t, 8)), 0x44440));
  }
  if (own.moving === 0) own.tiltStep = 0;
  else {
    const gap = own.tiltTarget - own.tilt;
    let step = 0;
    if (gap !== 0) step = gap < 0 ? (gap + 0xf) >> 4 : gap >> 4;
    if (0x100 < step) step = 0x100;
    else if (step < -0x100) step = -0x100;
    own.tiltStep = step;
    own.tilt = (own.tilt + step) | 0;
  }
  yaw += swing;
  return yaw | 0;
}

/**
 * Places a slot's eye to frame both fighters at the given angles: their average depth at
 * `distance` (800 or more), sideways so both are on screen with room, pulled back when they spread
 * past 280 pixels, raised so the higher head clears the top, and, unless `snap`, eased there. In
 * Tekken Ball the ball is framed too: past either fighter it takes that fighter's edge, and above
 * the higher head it is the top.
 */
function frameFighters(c: Camera, pitch: number, yaw: number, snap: number, distance: number, slot: number): void {
  const cam = c.state.camera;
  const offsets = [0, 0, 0];
  const h = cam.screen;
  if (distance < 0x321) distance = 800;
  const place = readSlot(c, slot);
  let [sx, , sz, spitch, syaw] = place as [number, number, number, number, number];
  const sy = place[1]!;
  const p = index18(-pitch);
  const sp = sin(c, p);
  const cp = cos(c, p);
  const t = index18(-yaw);
  const st = sin(c, t);
  const ct = cos(c, t);
  const [first, second] = trackedPair(c);
  let cx = div(first.at[0]! + second.at[0]!, 2);
  let cz = div(first.at[2]! + second.at[2]!, 2);
  let ox: number;
  let oz: number;
  if (snap === 0) {
    const i = index18(wrap18(yaw - syaw));
    const dx = sx - cx;
    const dz = sz - cz;
    ox = q12(mul(cos(c, i), dx) - mul(sin(c, i), dz));
    oz = q12(mul(sin(c, i), dx) + mul(cos(c, i), dz));
  } else {
    const i = index18(yaw + 0x30000);
    ox = q12(mul(distance, cos(c, i)));
    oz = q12(mul(distance, sin(c, i)));
  }
  cx += ox;
  cz += oz;
  /* Each fighter in the camera's frame: across, up, depth. */
  const X = [0, 0];
  const Y = [0, 0];
  const Z = [0, 0];
  const depth = [0, 0, 0];
  [first, second].forEach((tracked, i) => {
    const rx = tracked.at[0]! - cx;
    const rz = tracked.at[2]! - cz;
    const d = q12(mul(st, rx) + mul(ct, rz));
    X[i] = q12(mul(ct, rx) - mul(st, rz));
    Z[i] = q12(mul(cp, d) - mul(sp, tracked.at[1]! - sy));
    Y[i] = q12(mul(sp, d) + mul(cp, tracked.at[1]! - sy));
    depth[i] = d;
  });
  /* Tekken Ball's ball in the same frame, from where it is. */
  const ballAt = c.state.ball.position;
  const ball = c.state.mode === TEKKEN_BALL;
  const brx = ballAt[0]! - cx;
  const brz = ballAt[2]! - cz;
  const bd = q12(mul(st, brx) + mul(ct, brz));
  const ballX = q12(mul(ct, brx) - mul(st, brz));
  const ballZ = q12(mul(cp, bd) - mul(sp, ballAt[1]! - sy));
  const ballY = q12(mul(sp, bd) + mul(cp, ballAt[1]! - sy));
  const average = div(depth[0]! + depth[1]!, 2);
  const across = q12(mul(cp, average) - mul(sp, -0x1c2 - sy));
  const ground = q12(mul(sp, average) + mul(cp, -0x1c2 - sy));
  const push = distance - across;
  depth[2] = across + push;
  offsets[2] = offsets[2]! - push;
  Z[1] = Z[1]! + push;
  Z[0] = Z[0]! + push;
  /* The ball past either fighter widens the frame to it (its depth not pushed). */
  if (ball) {
    const [near, far] = X[0]! < X[1]! ? [0, 1] : [1, 0];
    if (ballX < X[near]!) {
      X[near] = ballX - 0x96;
      Z[near] = ballZ;
    } else if (X[far]! < ballX) {
      X[far] = ballX + 0x96;
      Z[far] = ballZ;
    }
  }

  /* Left and right edges on screen, with a margin of 150 either side. */
  const leftIsSecond = X[1]! <= X[0]!;
  let leftEdge: number;
  let far: number;
  let farDepth: number;
  if (leftIsSecond) {
    leftEdge = div(mul(X[1]! - 0x96, h), Z[1]!);
    far = X[0]! + 0x96;
    X[1] = X[1]! - 0x96;
    X[0] = far;
    farDepth = Z[0]!;
  } else {
    leftEdge = div(mul(X[0]! - 0x96, h), Z[0]!);
    far = X[1]! + 0x96;
    X[0] = X[0]! - 0x96;
    X[1] = far;
    farDepth = Z[1]!;
  }
  const l = leftIsSecond ? 1 : 0;
  const r = leftIsSecond ? 0 : 1;
  const rightEdge = div(mul(far, h), farDepth);
  const follow = cam.follow[slot]!;
  const rise = (): void => {
    const height = follow.rise;
    let settled: number;
    if (height < 0) settled = height - ((height + 0x1f) >> 5);
    else settled = 0 < height ? height - (height >> 3) : 0;
    follow.rise = settled;
    offsets[2] = offsets[2]! + settled;
    depth[2] = depth[2]! - settled;
    Z[0] = Z[0]! - settled;
    Z[1] = Z[1]! - settled;
  };
  if (rightEdge - leftEdge < 0x119) {
    let between = true;
    if (snap === 0) {
      const rightRoom = div(mul(Z[r]!, 0x30), h);
      const leftRoom = div(mul(Z[l]!, -0x30), h);
      if (!(rightRoom - (X[r]! - X[l]!) < leftRoom)) {
        between = false;
        if (-0x31 < leftEdge) {
          if (!(rightEdge < 0x31)) offsets[0] = offsets[0]! + shr(X[r]! - rightRoom, 3);
        } else offsets[0] = offsets[0]! + shr(X[l]! - leftRoom, 3);
        rise();
      }
    }
    if (between) {
      offsets[0] = shr(X[l]! + div(mul(X[r]! - X[l]!, Z[l]!), Z[l]! + Z[r]!), 3);
      if (snap !== 0) follow.rise = 0;
      else rise();
    }
  } else {
    const back = div(mul(h, X[r]! - X[l]!) + mul(Z[r]! - Z[l]!, -0x8c), 0x118);
    let target = Z[l]! - back;
    if (snap === 0) {
      const height = follow.rise;
      if (height < target) target = height + shr(target - height, 5);
      else target = height - shr(height - target, 3);
    }
    follow.rise = target | 0;
    offsets[2] = offsets[2]! + target;
    offsets[0] = shr(X[l]! - div(mul(back, -0x8c), h), 3);
    Z[0] = Z[0]! - target;
    depth[2] = depth[2]! - target;
    Z[1] = Z[1]! - target;
  }

  /* Height: keep the higher head inside the top of the screen. */
  let topY = Y[1]!;
  let topZ = Z[1]!;
  let headY = second.at[1]!;
  if (div(mul(Y[0]!, h), Z[0]!) < div(mul(topY, h), topZ)) {
    topY = Y[0]!;
    topZ = Z[0]!;
    headY = first.at[1]!;
  }
  let head = q12(mul(headY, cp));
  if (ball && ballY < topY) {
    head = q12(mul(ballAt[1]!, cp));
    topY = ballY;
    topZ = ballZ;
  }
  let margin = 100;
  if (slot === SHOT && pitch < 0) margin = 0x80;
  let lift = 0;
  let kept = cam.rise;
  if (slot === SHOT && 0 < pitch) {
    if (-0x3e9 < head) lift = div(mul(head + 1000, 0x170), 0x280);
    kept = lift;
    if (snap === 0) {
      if (cam.rise < lift) {
        if (0x1c < lift - cam.rise) {
          lift = cam.rise + 0x1c;
          kept = lift;
        }
      } else if (lift < cam.rise && 0x1c < cam.rise - lift) {
        lift = cam.rise - 0x1c;
        kept = lift;
      }
    }
  }
  cam.rise = kept | 0;
  head = q12(mul(cp, margin - div(mul(h, 0x1c2), distance)));
  let pull = div(mul(topZ - depth[2]!, -0x70) - mul(h, topY - ground), head + 0x70) - depth[2]!;
  if (pull < 0) pull = 0;
  if (snap === 0) {
    const current = follow.pull;
    let step: number;
    let settled = true;
    if (pull < current) {
      let gap = current - pull;
      let scaled = gap * 0x10;
      if (0x4b0 < gap) {
        gap = 0x4b0;
        scaled = 0x4b00;
      }
      step = shr((scaled - gap) * 8, 7) - gap;
    } else if (current < pull) {
      let gap = pull - current;
      if (800 < gap) gap = 800;
      step = shr(gap, 3);
    } else {
      step = 0;
      settled = false;
    }
    if (settled) {
      follow.pullStep = step | 0;
      pull = current + step;
    }
  } else {
    pull = 0;
    follow.pullStep = 0;
  }
  follow.pull = pull | 0;
  if (0 < pull) {
    offsets[2] = offsets[2]! - pull;
    depth[2] = depth[2]! + pull;
  }
  if (slot === FOLLOW) head += shr(div(mul(q12(mul(pull, cp)), h), distance), 4);
  const up = ground - div(mul(head, depth[2]!), h) + lift;

  /* Back from the camera's frame to the world. */
  const pp = index18(pitch);
  const sinP = sin(c, pp);
  const cosP = cos(c, pp);
  const yy = index18(yaw);
  const sinY = sin(c, yy);
  const cosY = cos(c, yy);
  const forward = q12(mul(offsets[2]!, cosP) - mul(up, sinP));
  const height = q12(mul(offsets[2]!, sinP) + mul(up, cosP));
  const wx = (mul(offsets[0]!, cosY) + mul(forward, -sinY)) | 0;
  const wz = (mul(offsets[0]!, sinY) + mul(forward, cosY)) | 0;
  if (snap === 0) {
    const dx = cx + q12(wx) - sx;
    const dz = cz + q12(wz) - sz;
    const dp = wrap18(pitch - spitch);
    const dyaw = wrap18(yaw - syaw);
    if (slot === FOLLOW) cam.follow[FOLLOW]!.moving = ((mul(dx, dx) + mul(dz, dz)) | 0) < 0x3e9 ? 0 : 1;
    sx += dx;
    sz += dz;
    spitch += dp;
    syaw += dyaw;
  } else {
    sx = cx + q12(wx);
    sz = cz + q12(wz);
    spitch = pitch;
    syaw = yaw;
  }
  writeSlot(c, [sx, sy + height, sz, spitch, syaw, place[5]!], slot);
}

/** Every slot's follow state cleared, the first two slots behind the arena's centre. */
function resetSlots(c: Camera, a: Fighter, b: Fighter): void {
  const cam = c.state.camera;
  resetScreen(c);
  track(c, a, b, 0);
  track(c, a, b, 0);
  for (const f of cam.follow) {
    f.swinging = 0;
    f.moving = 0;
    f.offFrames = 0;
    f.swing = 0;
    f.swingSpeed = 0;
    f.tilt = 0;
    f.tiltTarget = 0;
    f.tiltStep = 0;
    f.pull = 0;
    f.pullStep = 0;
    f.rise = 0;
  }
  for (const i of [FOLLOW, SHOT]) writeSlot(c, [0, -0x5aa, -0x1f40, 0, 0, cam.screen], i);
}

/** The follow camera, in its slot. */
function follow(c: Camera, a: Fighter, b: Fighter, snap: number, distance: number): void {
  let yaw = followYaw(c, a, b, snap, FOLLOW);
  let pitch = c.state.camera.follow[FOLLOW]!.tilt;
  if (c.state.mode === TEKKEN_BALL) {
    yaw = 0;
    pitch = 0;
  }
  frameFighters(c, pitch, yaw, snap, distance, FOLLOW);
}

/* ---- Shots: built-in ones and scripts. ---- */

/** A built-in shot's pitch and yaw, one of four each at random. */
function shotAngles(c: Camera, row: number): [number, number] {
  const shot = c.data.camera.shots[row]!;
  let pitch = shot.pitches[nextRandom(c.state.random) & 3]! << 5;
  const yaw = shot.yaws[nextRandom(c.state.random) & 3]! << 6;
  const kind = c.state.camera.arenaKind;
  if (pitch < 0 && kind === 2) pitch = 0;
  if (kind !== 0) pitch = div(pitch, 2);
  return [pitch, yaw];
}

/** Aims a built-in shot off the fighters' line. */
function aimShot(c: Camera, a: Fighter, b: Fighter): void {
  const cam = c.state.camera;
  const line = lineAngle(c, a, b);
  const [pitch, yaw] = shotAngles(c, cam.shotKind - 1);
  cam.shotYaw = (line * 0x40 + (cam.mirrored !== 0 ? -yaw : yaw)) | 0;
  cam.shotPitch = pitch;
}

const isScript = (shot: ShotRef): shot is ScriptRef => typeof shot !== 'number';

/** The kind of shot a shot is: its table row plus one for a built-in one, -1 a script, 0 nothing. */
function kindOf(c: Camera, shot: ShotRef): number {
  if (isScript(shot)) return -1;
  const v = shot >>> 0;
  if (v < 0x1e) return c.data.camera.shotRows[v]!;
  return (shot | 0) < 0 && v < 0x88000000 ? -1 : 0;
}

/** The slot of the moveset bound for a fighter slot (the first, when both share one). */
const boundSet = (c: Camera, slot: number): number => (c.data.sets[slot] == null ? 0 : slot);
const boundMoveset = (c: Camera, slot: number): Moveset => c.data.sets[boundSet(c, slot)]!.moveset;

/**
 * A camera byte's shots, from the entry past the byte's own: the game's below 0x2b, the moveset's
 * from there.
 */
function shotList(c: Camera, id: number, slot: number): { list: readonly (ShotChoice | null)[]; first: number } {
  if (id < 0x2b) return { list: c.data.camera.moveShots, first: id + 1 };
  return { list: boundMoveset(c, slot).shots, first: id - 0x2b + 1 };
}

function choiceAt(list: readonly (ShotChoice | null)[], at: number): ShotChoice {
  const choice = list[at];
  if (choice == null) throw new Error(`camera shot entry ${at} is not imported`);
  return choice;
}

/** The shot of a byte's entry: mirrored, the same script mirrored or the next entry's shot. */
function shotOf(c: Camera, list: readonly (ShotChoice | null)[], at: number, mirrored: number, slot: number): ShotRef {
  const entry = choiceAt(list, at);
  const cam = c.state.camera;
  cam.scriptMirror = 0;
  let shot = entry.shot;
  if (entry.kind !== 1 && mirrored !== 0) {
    const next = choiceAt(list, at + 1);
    if (next.kind === 0 || entry.odds < next.odds) cam.scriptMirror = 1;
    else shot = next.shot;
  }
  return typeof shot === 'number' ? shot : { set: boundSet(c, slot), index: shot.script };
}

/**
 * One of a camera byte's shots at random by its odds, and the variant chosen. Bytes 0x19 to 0x2a
 * have none, nor has practice.
 */
function chooseShot(c: Camera, id: number, mirrored: number, slot: number): { shot: ShotRef; variant: number } {
  const roll = nextRandom(c.state.random) & 0xfff;
  if (id < 1) id = 1;
  if (c.state.mode === Mode.PRACTICE || (id - 0x19) >>> 0 < 0x12) return { shot: -1, variant: 0 };
  const { list, first } = shotList(c, id, slot);
  let k = 0;
  while (choiceAt(list, first + k).odds < roll) k += 1;
  return { shot: shotOf(c, list, first + k, mirrored, slot), variant: k };
}

/** The shot of the variant already chosen, for a fighter's move (bytes from 0x2b only reach here). */
function variantShot(c: Camera, f: Fighter): ShotRef {
  const { list, first } = shotList(c, cameraByte(c, f), f.movesetSlot);
  return shotOf(c, list, first + c.state.camera.variant, c.state.camera.mirrored, f.movesetSlot);
}

/** How long a shot takes to hand back, by its row; a shot that is none or a script reads before the rows. */
function exitOf(c: Camera, shot: ShotRef): number {
  if (isScript(shot)) return c.data.camera.scriptExit;
  const v = shot >>> 0;
  if (v < 0x1e) {
    const row = c.data.camera.shotRows[v]! - 1;
    return row < 0 ? c.data.camera.noShotExit : c.data.camera.shots[row]!.exit;
  }
  return (shot | 0) < 0 && v <= 0x87ffffff ? c.data.camera.scriptExit : c.data.camera.noShotExit;
}

/** The length of the built-in shot playing. */
const shotLength = (c: Camera): number => c.data.camera.shots[c.data.camera.shotRows[c.state.camera.shot as number]! - 1]!.length;

/**
 * Starts a fighter's move's shot. A built-in shot returns its length (and marks a one-frame shot
 * short); a script returns 0; nothing, -1. `restart` keeps the move the shot was picked for.
 */
function startShot(c: Camera, f: Fighter, mirrored: number, slot: number, restart: boolean): number {
  const cam = c.state.camera;
  const { shot, variant } = chooseShot(c, cameraByte(c, f), mirrored, slot);
  cam.shot = shot;
  cam.variant = variant;
  if (shot === -1) return -1;
  cam.shotKind = kindOf(c, shot);
  if (cam.shotKind < 0) {
    cam.shortShot = 0;
    cam.shotMove = f.move;
    return 0;
  }
  if (0 < cam.shotKind) {
    const length = shotLength(c);
    if (!restart) cam.shotMove = f.move;
    cam.shortShot = length < 2 ? 1 : 0;
    return length;
  }
  return -1;
}

function startMoveShot(c: Camera, a: Fighter, b: Fighter, focus: number, mirrored: number): number {
  if (c.state.camera.shot !== -1) {
    resetCamera(c);
    return -1;
  }
  return startShot(c, focus === 0 ? a : b, mirrored, focus, false);
}

function restartMoveShot(c: Camera, f: Fighter, mirrored: number): number {
  if (c.state.camera.shot === -1) {
    resetCamera(c);
    return -1;
  }
  return startShot(c, f, mirrored, f.movesetSlot, true);
}

/** How long the shot playing takes to hand back; 5 when the view is already close to the follow camera's. */
function exitLength(c: Camera): number {
  let length = exitOf(c, c.state.camera.shot);
  const one = readSlot(c, SHOT);
  if (length < 2 && (one[3]! + 0xe37) >>> 0 < 0x1c6f) {
    const [first, second] = trackedPair(c);
    const [a, b] = c.state.fighters;
    let line = angle(c, second.at[0]! - first.at[0]!, second.at[2]! - first.at[2]!);
    if (b.screenX <= a.screenX) line = (line + 0x800) & 0xfff;
    const off = wrap18(one[4]! - line * 0x40);
    if ((off + 0xe37) >>> 0 < 0x1c6f) length = 5;
  }
  return length;
}

/** The frame a move's event of this code comes, less the fighter's frame, or -1 if it has none. */
function eventAhead(c: Camera, f: Fighter, code: number): number {
  const move = moveOf(c, f);
  if (move.events < 0) return -1;
  const events = c.data.sets[f.move!.set]!.moveset.events;
  let ahead = -1;
  for (let k = move.events; events[k]!.frame !== 0; k += 1) if (events[k]!.code === code) ahead = (events[k]!.frame & 0xffff) - f.frame;
  return ahead;
}

/**
 * Whether a throw's shot may cut back: unless the thrower's move or the thrown's still has its
 * throw-marking event (codes 0xb and 0xc) to come.
 */
function throwShotDone(c: Camera, a: Fighter, b: Fighter): boolean {
  if (a.throwHold < 1) return true;
  if (-1 < b.throwHold) return true;
  if (cameraByte(c, a) === 9) return true;
  if (c.state.camera.shortShot === 1) return false;
  if (moveOf(c, b).flags & 0x400000) return true;
  const mine = eventAhead(c, a, 0xb);
  const theirs = eventAhead(c, b, 0xc);
  if (mine < 0 && theirs < 0) return false;
  if (mine <= theirs) return theirs === 0 && a.next.type !== 0x21;
  return mine === 0 && a.next.type !== 0x21;
}

/** A throw's next shot as it chains. */
function chainShot(c: Camera, mirrored: number, p: Fighter, other: Fighter, fromFacing: boolean): void {
  const cam = c.state.camera;
  cam.mirrored = mirrored;
  cam.sceneLength = -1;
  cam.watched = cam.focus;
  const length = restartMoveShot(c, p, mirrored);
  if (length < 0) cam.shot = -1;
  else if (cam.shotKind < 0) {
    if (fromFacing) {
      cam.shotYaw = (0x400 - shr(other.heading, 4)) & 0xfff;
      cam.scriptOrigin[0] = other.skeleton.base.translation[0]!;
      cam.scriptOrigin[1] = other.position[1]!;
      cam.scriptOrigin[2] = other.skeleton.base.translation[2]!;
      cam.scriptFrame = 0;
      startScript(c, cam.shot);
      stepScript(c);
      cam.scriptRestart = 1;
    }
    cam.state = 6;
    cam.left = length;
    cam.length = length;
  } else {
    cam.countdown = 0x10;
    cam.state = 2;
    cam.length = 1;
    cam.left = 1;
    cam.script = null;
  }
  cam.countdown = -1;
  cam.weights[SHOT] = 0x1000;
  cam.weights[FOLLOW] = 0;
  cam.weights[SCRIPT] = 0;
  cam.shortShot = 1;
}

function scriptOf(c: Camera, ref: ScriptRef): CameraScript {
  const script = c.data.sets[ref.set]?.moveset.scripts[ref.index];
  if (script === undefined) throw new Error(`camera script ${ref.index} of slot ${ref.set} is not imported`);
  return script;
}

/** Starts a script; returns its side code. */
function startScript(c: Camera, shot: ShotRef): number {
  if (!isScript(shot)) throw new Error(`camera shot ${shot} is not a script`);
  const cam = c.state.camera;
  const script = scriptOf(c, shot);
  cam.script = shot;
  cam.scriptFrame = 0;
  cam.scriptFrames = script.frames;
  return script.side;
}

/** A segment's channel value at a frame within a script, or none past it. */
function segmentValue(c: Camera, segment: ScriptSegment, f: number, start: number, frames: number): { value: number | null; next: number } {
  switch (segment.kind) {
    case 'linear': {
      const next = start + segment.length;
      if (!(f < next)) return { value: null, next };
      const step = segment.slope * (f - start);
      return { value: s16((frames < 10 ? step : Math.trunc(step / 0x20)) + segment.start), next };
    }
    case 'constant': {
      const next = start + segment.length;
      return { value: f < next ? segment.value : null, next };
    }
    case 'keys': {
      let span = 0;
      for (const s of segment.spans) span += s;
      const end = start + span;
      return { value: f <= end ? s16(keyedAt(segment, f - start, span + 1, c.data.curves)) : null, next: end + 1 };
    }
    case 'samples': {
      const next = start + segment.values.length;
      return { value: f < next ? segment.values[f - start]! : null, next };
    }
  }
}

/**
 * A script's channels at a frame, one value for each channel whose segments reach the frame, in
 * turn (every other channel plays backwards); a channel past its end gives none, and what it would
 * have written keeps what an earlier frame left.
 */
function sampleScript(c: Camera, script: CameraScript, frame: number, out: number[]): void {
  let o = 0;
  script.channels.forEach((segments, channel) => {
    const f = channel & 1 ? script.frames - (frame + 1) : frame;
    let start = 0;
    for (const segment of segments) {
      if (f < start) break;
      const { value, next } = segmentValue(c, segment, f, start, script.frames);
      start = next;
      if (value !== null) {
        out[o] = value;
        o += 1;
        break;
      }
    }
  });
}

/**
 * The script's camera this frame, and a frame on: the eye and target scaled by 20/32, the progress
 * to its end; or `halved` (the attract intro's), the eye and target halved, no progress and a
 * screen of 0x1c2.
 */
function stepScript(c: Camera, halved = false): void {
  const cam = c.state.camera;
  if (cam.script === null) throw new Error('a camera script steps with none started');
  const frame = cam.scriptFrame;
  cam.scriptFrame = s16(frame + 1);
  const v = cam.scriptValues;
  sampleScript(c, scriptOf(c, cam.script), frame, v);
  const shot = cam.scriptShot;
  if (halved) {
    for (let i = 0; i < 3; i += 1) {
      shot.eye[i] = s16(div(v[i]!, 2));
      shot.target[i] = s16(div(v[3 + i]!, 2));
    }
    shot.screen = INTRO_SCREEN;
    shot.progress = 0;
    return;
  }
  let progress = shr(v[6]!, 3);
  if (progress < 0) progress = 0;
  else if (SCRIPT_END < progress || cam.scriptFrames <= cam.scriptFrame) progress = SCRIPT_END;
  for (let i = 0; i < 3; i += 1) {
    shot.eye[i] = s16(shr(v[i]! * 0x14, 5));
    shot.target[i] = s16(shr(v[3 + i]! * 0x14, 5));
  }
  shot.screen = 0x226;
  shot.progress = progress;
}

function stopScript(c: Camera): void {
  c.state.camera.scriptFrame = -1;
  c.state.camera.script = null;
}

/**
 * The script's slot from its camera this frame, turned by the shot's yaw about its origin (and
 * mirrored), its eye drawn toward the target when the screen's distance differs. Returns the
 * progress before stepping.
 */
function scriptPlace(c: Camera, halved = false): number {
  const cam = c.state.camera;
  const shot = cam.scriptShot;
  let ref = shot.screen;
  const progress = shot.progress;
  const eye = [...shot.eye];
  const target = [...shot.target];
  if (cam.scriptMirror !== 0) {
    eye[2] = s16(-eye[2]!);
    target[2] = s16(-target[2]!);
  }
  const turn = cam.shotYaw & 0xfff;
  const s = sin(c, turn);
  const k = cos(c, turn);
  if (cam.scaleScripts !== 0) {
    const h = cam.screen;
    for (let i = 0; i < 3; i += 1) eye[i] = s16(target[i]! + div(mul(eye[i]! - target[i]!, h), ref));
    ref = h;
  }
  const [ox, oy, oz] = cam.scriptOrigin as [number, number, number];
  const from = [ox + q12(mul(k, eye[0]!) - mul(s, eye[2]!)), oy + eye[1]!, oz + q12(mul(s, eye[0]!) + mul(k, eye[2]!))];
  const to = [ox + q12(mul(k, target[0]!) - mul(s, target[2]!)), oy + target[1]!, oz + q12(mul(s, target[0]!) + mul(k, target[2]!))];
  const out = [0, 0, 0, 0, 0, 0];
  lookAt(c, out, from, to, ref);
  writeSlot(c, out, SCRIPT);
  stepScript(c, halved);
  return progress;
}

/**
 * A script camera. Restarting, the shot's script starts again around `other`, turned by its side
 * code. Otherwise the script of `p`'s new move starts, once per move (camera bytes below 0x2b chain
 * to a built-in shot instead). Then a frame of it plays, returning its progress.
 */
function scriptCamera(c: Camera, restart: boolean, p: Fighter, other: Fighter): number {
  const cam = c.state.camera;
  if (restart) {
    cam.scriptFrame = 0;
    const side = startScript(c, cam.shot);
    stepScript(c);
    const facing = shr(other.heading, 4);
    let yaw = cam.shotYaw;
    if (side === 0 || side === 4) yaw = 0x400 - facing;
    else if (side === 1) yaw = 0x800 - facing;
    else if (side === 2) yaw = -facing;
    else if (side === 3 || side === 5) yaw = -(facing + 0x400);
    cam.shotYaw = yaw & 0xfff;
    for (let i = 0; i < 3; i += 1) cam.scriptOrigin[i] = other.position[i]!;
  } else if (!sameMove(p.move, cam.shotMove) && 0 < p.throwHold && cameraByte(c, p) !== 0x25) {
    cam.shotMove = p.move;
    if (cameraByte(c, p) < 0x2b) {
      const base = p.skeleton.base.translation;
      const otherBase = other.skeleton.base.translation;
      const ax = s16(base[0]!);
      const ay = s16(base[2]!);
      const bx = s16(div((base[0]! + otherBase[0]!) | 0, 2));
      const by = s16(div((base[2]! + otherBase[2]!) | 0, 2));
      const cx = cam.scriptShot.eye[0]!;
      const cy = cam.scriptShot.eye[2]!;
      const area = ax * by + bx * cy + cx * ay - ax * cy - bx * ay - cx * by;
      chainShot(c, (area | 0) >>> 31, p, other, false);
      return -1;
    }
    cam.shot = variantShot(c, p);
    cam.shotKind = kindOf(c, cam.shot);
    startScript(c, cam.shot);
    stepScript(c);
    cam.scriptFrame = 0;
  }
  if (cam.shotKind < 0) return scriptPlace(c);
  resetCamera(c);
  return -1;
}

/**
 * A move's shot in its slot. A script plays through `scriptCamera`; a built-in shot frames the
 * fighters at its angles, and Paul's throw that chains (camera byte `c`) chains another shot.
 */
function moveShot(c: Camera, a: Fighter, b: Fighter, restart: number, distance: number, focus: number): number {
  const cam = c.state.camera;
  const p = focus === 0 ? a : b;
  const other = focus === 0 ? b : a;
  if (cam.shotKind < 0) return scriptCamera(c, restart !== 0, p, other);
  if (cam.shotKind < 1) {
    resetCamera(c);
    return 0;
  }
  frameFighters(c, cam.shotPitch, cam.shotYaw, restart, shr(distance * 0x72, 7), SHOT);
  if (restart !== 0) return 0;
  if (sameMove(p.move, cam.shotMove)) return 0;
  const byte = cameraByte(c, p);
  if (0 < p.throwHold && byte !== 0x25) {
    const chains = cam.arenaKind !== 2 && p.character === 0 && byte === 0x63;
    cam.shotMove = p.move;
    if (chains) chainShot(c, cam.mirrored, p, other, true);
  }
  return 0;
}

/* ---- Scenes: shots a counted hit calls for. ---- */

/**
 * A scene for a fighter whose hit counted cleanly, by what the other is doing, chosen at random by
 * its odds. Returns the fighter's index, or -1.
 */
function chooseScene(c: Camera, a: Fighter, b: Fighter): number {
  const cam = c.state.camera;
  const tables = c.data.camera;
  if (a.hitClean !== 0 && b.hitClean !== 0) return -1;
  for (let k = 0; k < 2; k += 1) {
    const p = k === 0 ? a : b;
    const other = k === 0 ? b : a;
    if (p.hitClean === 0) continue;
    const long = p.knockedOut !== 0 ? 0x1b < p.pressure : false;
    const kind = long ? 3 : p.counterHit !== 0 ? 2 : p.fromBehind !== 0 ? 1 : 0;
    for (const call of tables.sceneCalls) {
      if (kind !== 3 && !(other.character === call.character && s16(other.moveId) === call.moveId)) continue;
      const roll = nextRandom(c.state.random) & 0xfff;
      const list = tables.sceneLists[call.list]!;
      let found = false;
      for (let e = 0; ; e += 1) {
        const entry = list[e];
        if (entry === undefined) throw new Error(`scene list ${call.list} has no entry ${e}`);
        if (roll <= entry.odds) {
          const scene = entry.scenes[kind]!;
          if (tables.scenes[scene]!.kind !== -1) {
            found = true;
            cam.scene = scene;
          }
          break;
        }
        if (0x1000 < (list[e + 1]?.odds ?? 0x1001)) break;
      }
      if (!found) return -1;
      const best = p.bestHit as number | null;
      if (best === null) throw new Error(`fighter ${k}'s scene watches no counted hit`);
      const point = p.hitRecords[best]!.point;
      for (let i = 0; i < 3; i += 1) cam.sceneTarget[i] = point[i]!;
      return k;
    }
  }
  cam.scene = null;
  return -1;
}

function sceneOf(c: Camera) {
  const scene = c.state.camera.scene;
  if (scene === null) throw new Error('a scene plays with none chosen');
  return c.data.camera.scenes[scene]!;
}

/** A scene starts: its length. */
function startScene(c: Camera): number {
  c.state.camera.shotKind = 1;
  return sceneOf(c).length;
}

/**
 * A scene in the shot slot: kind 0 frames the fighters at one of its angles, kind 1 pulls in toward
 * its point over its hold.
 */
function sceneShot(c: Camera, a: Fighter, b: Fighter, restart: number, distance: number): void {
  const cam = c.state.camera;
  const scene = sceneOf(c);
  if (scene.kind !== 0 && scene.kind !== 1) {
    resetCamera(c);
    return;
  }
  if (restart !== 0) {
    const line = lineAngle(c, a, b) << 6;
    let pitch = scene.pitches[nextRandom(c.state.random) & 3]! << 6;
    const pick = nextRandom(c.state.random) & 3;
    let yaw = scene.yaws[pick]! * 0x40;
    if (cam.arenaKind !== 0) pitch = 0;
    if (cam.mirrored !== 0) yaw = scene.yaws[pick]! * -0x40;
    cam.shotYaw = (line + yaw) | 0;
    cam.shotPitch = pitch;
  }
  if (scene.kind === 0) {
    frameFighters(c, cam.shotPitch, cam.shotYaw, restart, shr(distance * 0x72, 7), SHOT);
    return;
  }
  let t = div(cam.sceneLeft << 12, cam.sceneLength) - 0x400;
  if (t < 1) t = 0;
  const [far, near] = scene.reach;
  t = q12(mul(far - near, t));
  const h = cam.screen;
  const reach = div(mul(t + near, h), 0x2ee);
  const p = index18(cam.shotPitch);
  const y = (shr(cam.shotYaw, 6) + 0x400) & 0xfff;
  const [tx, ty, tz] = cam.sceneTarget as [number, number, number];
  const from = [tx - q12(mul(q12(mul(reach, cos(c, y))), cos(c, p))), ty - q12(mul(reach, sin(c, p))), tz - q12(mul(q12(mul(reach, sin(c, y))), cos(c, p)))];
  const out = [0, 0, 0, 0, 0, 0];
  lookAt(c, out, from, [tx, ty, tz], h);
  writeSlot(c, out, SHOT);
}

/* ---- The opening. ---- */

/** Picks the opening's sweep (the next of ten), its length by round, and snaps the follow camera to start from. */
function startOpening(c: Camera, a: Fighter, b: Fighter): void {
  const opening = c.state.camera.opening;
  do {
    opening.count = (opening.count + 1) | 0;
    opening.sweep = s16(opening.count % 10);
    if (c.state.camera.arenaKind === 0) break;
  } while (7 < s16(opening.count % 10));
  opening.length = c.state.round.number === 1 ? 0x78 : 0x35;
  opening.left = opening.length;
  follow(c, a, b, 1, FOLLOW_DISTANCE);
  const zero = readSlot(c, FOLLOW);
  for (let k = 0; k < 3; k += 1) opening.from.eye[k] = zero[k]!;
  opening.from.pitch = zero[3]!;
  opening.from.yaw = zero[4]!;
  opening.from.screen = zero[5]!;
}

/** A frame of the sweep in the script slot (Tekken Ball's own); returns its weight, fading over the last 16 frames. */
function stepOpening(c: Camera): number {
  const opening = c.state.camera.opening;
  const sweep = c.state.mode === TEKKEN_BALL ? c.data.camera.ballSweep : c.data.camera.openingSweeps[opening.sweep]!;
  const out = readSlot(c, FOLLOW);
  const ease = sin(c, div(opening.left << 10, opening.length) + 0xc00) + 0x1000;
  const [fx, fy, fz] = opening.from.eye as [number, number, number];
  const from = [fx + q12(mul(sweep[0]!, ease)), fy + q12(mul(sweep[1]!, ease)), fz + q12(mul(sweep[2]!, ease))];
  lookAt(c, out, from, [fx, fy, 0], out[5]!);
  writeSlot(c, out, SCRIPT);
  const left = s16(opening.left - 1);
  opening.left = left;
  return 0x10 < left ? 0x1000 : left << 8;
}

/* ---- Knockouts and the round's finish. ---- */

/** A view (angles ×64) from an eye looking at a point. */
function aimFrom(c: Camera, eye: readonly number[], target: readonly number[], out: CameraView): void {
  const dx = target[0]! - eye[0]!;
  const dz = target[2]! - eye[2]!;
  let pitch = angle(c, isqrt((mul(dx, dx) + mul(dz, dz)) | 0), target[1]! - eye[1]!);
  pitch = pitch & 0x800 ? (pitch & 0xfff) - 0x1000 : pitch & 0xfff;
  out.pitch = pitch << 6;
  out.yaw = (angle(c, dx, dz) - 0x400) << 6;
  out.roll = 0;
  for (let k = 0; k < 3; k += 1) out.eye[k] = eye[k]!;
}

const newView = (): CameraView => ({ pitch: 0, yaw: 0, roll: 0, eye: [0, 0, 0] });

/**
 * Aims a knockout camera at a fighter: at its root, the pitch held so neither its head nor its feet
 * leave the view; closer than about 2.3 m, the eye moves out around it.
 */
function aimAtFighter(c: Camera, f: Fighter, eye: readonly number[], out: CameraView): void {
  const root = f.skeleton.base.translation;
  aimFrom(c, eye, root, out);
  const probe = newView();
  aimFrom(c, eye, [root[0]!, (f.skeleton.joints[2]!.world.translation[1]! - 0x122) | 0, root[2]!], probe);
  let pitch = out.pitch;
  if (probe.pitch + 0xfa4 < pitch) pitch = probe.pitch + 0xfa4;
  out.pitch = pitch;
  aimFrom(c, eye, [root[0]!, 0, root[2]!], probe);
  if (probe.pitch - 0x1b05 < pitch) pitch = probe.pitch - 0x1b05;
  out.pitch = pitch;
  if (c.state.camera.arenaKind !== 0 && pitch < 0) out.pitch = 0;
  const dx = out.eye[0]! - root[0]!;
  const dz = out.eye[2]! - root[2]!;
  if (mul(dx, dx) + mul(dz, dz) < 0x2014e40) {
    const i = shr(out.yaw, 6) & 0xfff;
    out.eye[0] = root[0]! + q12(mul(sin(c, i), 0x16a8));
    out.eye[2] = root[2]! - q12(mul(cos(c, i), 0x16a8));
  }
}

/** The drawn view from a knockout camera, angles back to 12-bit. */
function useView(c: Camera, view: CameraView): void {
  const drawn = c.state.camera.drawn;
  drawn.pitch = shr(view.pitch, 6);
  drawn.yaw = shr(view.yaw, 6);
  drawn.roll = shr(view.roll, 6);
  for (let k = 0; k < 3; k += 1) drawn.eye[k] = view.eye[k]!;
  viewMatrix(c.data, drawn, c.state.view);
}

/** The frame seed stepped, as the knockout cameras draw from it. */
const nextSeed = (seed: number): number => mul((seed + 1) | 0, 0x10dcd) >>> 0;
function drawSeed(c: Camera): number {
  c.state.frameSeed = nextSeed(c.state.frameSeed);
  return c.state.frameSeed;
}

/** The first knockout camera: an eye about 4 m off the fighter, at random. */
function startFirstKnockout(c: Camera, f: Fighter): void {
  const seed = drawSeed(c);
  const i = ((((seed >>> 16) * 0x2ab) >>> 16) + 0x2ab - shr(f.facing, 4)) & 0xfff;
  const root = f.skeleton.base.translation;
  const eye = [root[0]! + q12(mul(cos(c, i), 0xf71)), 0, root[2]! + q12(mul(sin(c, i), 0xf71))];
  eye[1] = c.state.camera.arenaKind === 0 ? -0x352 : (f.skeleton.joints[2]!.world.translation[1]! - 0x122) | 0;
  const view = c.state.camera.knockout.first;
  for (let k = 0; k < 3; k += 1) view.eye[k] = eye[k]!;
  aimAtFighter(c, f, eye, view);
}

/** Following the fighter from at most 2.5 m, turning a 32nd of the way a frame. */
function stepFirstKnockout(c: Camera, f: Fighter): void {
  const view = c.state.camera.knockout.first;
  const root = f.skeleton.base.translation;
  let [ex, ey, ez] = view.eye as [number, number, number];
  const dx = root[0]! - ex;
  const dy = root[1]! - ey;
  const dz = root[2]! - ez;
  const d = tableRoot((mul(dx, dx) + mul(dy, dy) + mul(dz, dz)) | 0, c.data.math);
  if (0 < d - 0x9d1) {
    ex += div(dx * 8, d);
    ey += div(dy * 8, d);
    ez += div(dz * 8, d);
  }
  view.eye[0] = ex;
  view.eye[1] = ey;
  view.eye[2] = ez;
  const aim = newView();
  aimAtFighter(c, f, [ex, ey, ez], aim);
  view.pitch = (view.pitch + shr(wrap18(aim.pitch - view.pitch), 5)) | 0;
  view.yaw = (view.yaw + shr(wrap18(aim.yaw - view.yaw), 5)) | 0;
  useView(c, view);
}

/** The second knockout camera: low, beside the fighter, drifting. */
function startSecondKnockout(c: Camera, f: Fighter): void {
  const placing = c.data.camera.knockout;
  const knockout = c.state.camera.knockout;
  const view = knockout.second;
  const first = nextSeed(c.state.frameSeed);
  let seed = nextSeed(first);
  let out = placing.out[((seed >>> 16) * 3) >>> 16]!;
  seed = nextSeed(seed);
  const height = placing.heights[((seed >>> 16) * 3) >>> 16]!;
  view.eye[1] = height;
  if (height < -0x79d) out = 0x898;
  const i = (0x400 - shr(f.facing, 4)) & 0xfff;
  const s = sin(c, i);
  const k = -cos(c, i);
  knockout.drift[0] = s16(shr(k, 9));
  knockout.drift[1] = s16(shr(-s, 9));
  let across = mul(out, s);
  let along = mul(out, k);
  seed = nextSeed(seed);
  c.state.frameSeed = seed;
  if (seed >>> 16 < 0x8000) {
    across = -across;
    along = -along;
  }
  const ahead = placing.ahead[((first >>> 16) * 3) >>> 16]!;
  const root = f.skeleton.base.translation;
  view.eye[0] = root[0]! + q12((mul(ahead, cos(c, i)) + across) | 0);
  view.eye[2] = root[2]! + q12((mul(ahead, s) + along) | 0);
  aimAtFighter(c, f, [view.eye[0]!, view.eye[1]!, view.eye[2]!], view);
}

/** The second camera drifting, kept 2.3 m off, rising as it looks down. */
function stepSecondKnockout(c: Camera, f: Fighter): void {
  const knockout = c.state.camera.knockout;
  const view = knockout.second;
  const root = f.skeleton.base.translation;
  let ex = view.eye[0]! + knockout.drift[0]!;
  let ey = view.eye[1]!;
  let ez = view.eye[2]! + knockout.drift[1]!;
  const dx = root[0]! - ex;
  const dy = root[1]! - ey;
  const dz = root[2]! - ez;
  const gap = 0x904 - tableRoot((mul(dx, dx) + mul(dy, dy) + mul(dz, dz)) | 0, c.data.math);
  if (0 < gap) {
    const flat = tableRoot((mul(dx, dx) + mul(dz, dz)) | 0, c.data.math);
    ex -= shr(div(mul(gap, dx), flat), 4);
    ez -= shr(div(mul(gap, dz), flat), 4);
  }
  view.eye[0] = ex | 0;
  view.eye[2] = ez | 0;
  const aim = newView();
  aimAtFighter(c, f, [ex, ey, ez], aim);
  view.pitch = (view.pitch + shr(wrap18(aim.pitch - view.pitch), 5)) | 0;
  view.yaw = (view.yaw + shr(wrap18(aim.yaw - view.yaw), 4)) | 0;
  const pitch = view.pitch;
  if (0 < pitch) {
    const floor = q12(mul(sin(c, shr(pitch, 6)), -0x1d4c));
    if (floor < ey) ey += shr(floor - ey, 4);
  }
  view.eye[1] = ey | 0;
  useView(c, view);
}

/** The knockout cameras take turns. */
function startKnockout(c: Camera, f: Fighter, slot: number): void {
  const knockout = c.state.camera.knockout;
  c.state.camera.following = 0;
  knockout.turn = (knockout.turn + 1) & 1;
  knockout.fighter = slot;
  if (knockout.turn === 0) startFirstKnockout(c, f);
  else startSecondKnockout(c, f);
}

function stepKnockout(c: Camera): void {
  const knockout = c.state.camera.knockout;
  c.state.camera.following = 0;
  const f = c.state.fighters[knockout.fighter];
  if (f === undefined) throw new Error(`the knockout camera watches fighter ${knockout.fighter}`);
  if (knockout.turn === 0) stepFirstKnockout(c, f);
  else stepSecondKnockout(c, f);
}

/** Sets up the round's finishing shot on a fighter (`fallen`: the loser, looked down on). */
export function startFinish(state: FightState, data: FightData, f: Fighter, fallen: number): void {
  const c: Camera = { state, data };
  const cam = state.camera;
  const finish = cam.finish;
  cam.weights[FOLLOW] = 0x1000;
  cam.weights[SHOT] = 0;
  cam.weights[SCRIPT] = 0;
  if (fallen === 0) {
    finish.height = 0;
    finish.turn = (nextRandom(state.random) & 0x7f) - 0x40;
    return;
  }
  const seed = drawSeed(c);
  const root = f.skeleton.base.translation;
  const i = ((((seed >>> 16) * 0x401) >>> 16) + 0x200 - shr(f.heading, 4)) & 0xfff;
  const reach = f.character === 0xb ? 0x19c4 : 0xf8a;
  finish.eye[0] = root[0]! + q12(mul(cos(c, i), reach));
  finish.eye[2] = root[2]! + q12(mul(sin(c, i), reach));
  finish.eye[1] = -0x5dc;
  finish.target[0] = root[0]!;
  finish.target[1] = -0x591;
  finish.target[2] = root[2]!;
  finish.roll = 0;
}

/** A view (12-bit angles) from the finishing shot's eye and target. */
function viewFromFinish(c: Camera, out: CameraView): void {
  const finish = c.state.camera.finish;
  const dx = finish.target[0]! - finish.eye[0]!;
  const dz = finish.target[2]! - finish.eye[2]!;
  let pitch = angle(c, isqrt((mul(dx, dx) + mul(dz, dz)) | 0), finish.target[1]! - finish.eye[1]!);
  pitch = pitch & 0x800 ? (pitch & 0xfff) - 0x1000 : pitch & 0xfff;
  out.pitch = pitch;
  out.yaw = angle(c, dx, dz) - 0x400;
  out.roll = finish.roll;
  for (let k = 0; k < 3; k += 1) out.eye[k] = finish.eye[k]!;
}

/** The round's finishing shot: easing toward the fighter, or (`fallen` odd) straight down on it from above. */
function stepFinish(c: Camera, f: Fighter, fallen: number): void {
  const cam = c.state.camera;
  const finish = cam.finish;
  cam.following = 0;
  const root = f.skeleton.base.translation;
  const drawn = cam.drawn;
  if ((fallen & 1) === 0) {
    const dx = finish.target[0]! - finish.eye[0]!;
    const dz = finish.target[2]! - finish.eye[2]!;
    const d = tableRoot((mul(dx, dx) + mul(dz, dz)) | 0, c.data.math);
    const room = f.character === 0xb ? d - 0x188a : d - 0xe50;
    if (0 < room) {
      finish.eye[0] = (finish.eye[0]! + div(dx * 2, d)) | 0;
      finish.eye[2] = (finish.eye[2]! + div(dz * 2, d)) | 0;
    }
    finish.target[0] = (finish.target[0]! + shr((root[0]! - finish.target[0]!) * 6, 7)) | 0;
    finish.target[1] = (finish.target[1]! + shr((f.skeleton.joints[2]!.world.translation[1]! - finish.target[1]!) * 6, 7)) | 0;
    finish.target[2] = (finish.target[2]! + shr((root[2]! - finish.target[2]!) * 6, 7)) | 0;
    if (cam.arenaKind === 2 && finish.eye[1]! - finish.target[1]! < -400) finish.target[1] = finish.eye[1]! + 400;
    viewFromFinish(c, drawn);
  } else {
    if (c.state.mode !== TEKKEN_BALL) c.state.overhead = 1;
    drawn.pitch = 0x400;
    drawn.roll = 0;
    drawn.yaw = (finish.turn + 0x800 - shr(f.heading, 4)) | 0;
    drawn.eye[0] = root[0]!;
    drawn.eye[1] = (-0x1ead - finish.height) | 0;
    drawn.eye[2] = root[2]!;
  }
  viewMatrix(c.data, drawn, c.state.view);
}

/* ---- The replay. ---- */

/** The replay tracks the fighters' roots, every fourth frame while one spins. */
function trackReplay(c: Camera): void {
  const replay = c.state.camera.replay;
  if (lockedOn(c) < 0) replay.tick = -1;
  else replay.tick = replay.tick < 0 ? 0 : s16(replay.tick + 1);
  for (let k = 0; k < 2; k += 1) {
    const f = c.state.fighters[k]!;
    if (replay.tick < 0 || (replay.tick & 3) === 0) {
      const root = f.skeleton.base.translation;
      replay.points.x[k] = root[0]!;
      replay.points.z[k] = root[2]!;
      replay.points.y[k] = Math.min(root[1]!, f.skeleton.joints[2]!.world.translation[1]!);
      const at = c.state.camera.tracked[k]!.at;
      at[0] = replay.points.x[k]!;
      at[1] = replay.points.y[k]!;
      at[2] = replay.points.z[k]!;
    }
  }
}

/**
 * The replay's camera starts: far out, at a random angle off the fighters' line, and on alternate
 * replays swinging slowly across.
 */
export function startReplayCamera(state: FightState, data: FightData): void {
  const c: Camera = { state, data };
  const [a, b] = state.fighters;
  const cam = state.camera;
  const replay = cam.replay;
  resetCamera(c);
  resetSlots(c, a, b);
  replay.tick = -1;
  replay.active = 1;
  cam.weights[FOLLOW] = 0;
  cam.weights[SHOT] = 0x1000;
  cam.weights[SCRIPT] = 0;
  replay.snap = 1;
  replay.distance = 0x2b1a;
  replay.pitch = 0;
  replay.alternate = (replay.alternate + 1) & 1;
  const [first, second] = trackedPair(c);
  const line = angle(c, second.at[0]! - first.at[0]!, second.at[2]! - first.at[2]!);
  replay.yaw = s16((line << 16) >> 10);
  nextRandom(state.random);
  if (replay.alternate === 0) {
    replay.yaw = s16(replay.yaw - 0x71c7 + randomBelow(state.random, 0xe38e));
    replay.swing = s16(Math.trunc(((randomBelow(state.random, 0x1e) + 0x19) * 0x40000) / 360));
    replay.swingTarget = s16(-Math.trunc(((randomBelow(state.random, 0x1e) + 0x19) * 0x40000) / 360));
    if (nextRandom(state.random) & 1) {
      replay.swing = s16(-replay.swing);
      replay.swingTarget = s16(-replay.swingTarget);
    }
  } else {
    const turn = randomBelow(state.random, 0x15555);
    replay.swingTarget = 0;
    replay.swing = 0;
    replay.yaw = s16(replay.yaw + 0x5556 + turn);
  }
  stepReplayCamera(state, data);
}

/** A replay frame: framing from the shot slot, closing in and swinging. */
export function stepReplayCamera(state: FightState, data: FightData): void {
  const c: Camera = { state, data };
  const cam = state.camera;
  const replay = cam.replay;
  if (replay.active === 0) return;
  trackReplay(c);
  frameFighters(c, replay.pitch, replay.swing + replay.yaw, replay.snap, replay.distance, SHOT);
  replay.snap = 0;
  const gap = wrap18(replay.swingTarget - replay.swing);
  replay.swing = s16(replay.swing + shr(gap, 7));
  replay.distance = (replay.distance + shr((0x113d - replay.distance) * 6, 8)) | 0;
  useSlot(c, SHOT);
  cam.following = 0;
}

/* ---- The attract mode's camera: four shots in turn, each 720 frames. ---- */

/** The orbit's distance, and the sweep's: how far back from the first fighter, how far it slides either way, its frames. */
const ORBIT_DISTANCE = 0x17f2;
const SWEEP = { back: 0x11f5, slide: 4000, frames: 0x2d0, low: -0x62a, high: -0x5aa } as const;
/** A shot's frames. */
const ATTRACT_SHOT = 0x2d0;

/** Circling the fighters, at a height and a speed drawn when it starts (lower over some grounds). */
function orbit(c: Camera, start: boolean): void {
  const o = c.state.camera.attract.orbit;
  if (start) {
    const kind = c.state.camera.arenaKind;
    const pitches = c.data.camera.orbitPitches;
    if (kind === 1) o.pitch = div(pitches[nextRandom(c.state.random) & 3]!, 2);
    else if (kind === 0) o.pitch = pitches[nextRandom(c.state.random) & 7]!;
    else if (kind === 2) o.pitch = shr(pitches[nextRandom(c.state.random) & 1]!, 2);
    o.yaw = (nextRandom(c.state.random) & 0xfff) << 6;
    o.speed = c.data.camera.orbitSpeeds[nextRandom(c.state.random) & 1]!;
  }
  c.state.camera.shot = -1;
  o.yaw = (o.yaw + o.speed) & 0x3ffff;
  frameFighters(c, o.pitch, o.yaw, 1, ORBIT_DISTANCE, FOLLOW);
}

/** Low tracking shots past the first fighter: held low (`which` 0), or rising and falling as they slide across (1, 2). */
function sweepShot(c: Camera, a: Fighter, start: number): void {
  const sw = c.state.camera.attract.sweep;
  if (start < 0) {
    sw.which = ~start;
    sw.angle = a.facing;
    sw.t = 0;
  }
  let height = 0;
  let slide = 0;
  if (sw.which === 0) height = SWEEP.low;
  else if (sw.which === 1 || sw.which === 2) {
    height = q12(sin(c, div(mul(sw.t, 0x800), SWEEP.frames)) * 100) + SWEEP.high;
    slide = div(mul(sw.t, SWEEP.slide * 2), SWEEP.frames) - SWEEP.slide;
  }
  sw.t += 1;
  if (a.beingThrown === 0) sw.angle = 0x400 - shr(a.facing, 4);
  const i = index18(sw.angle);
  const [p, q] = trackedPair(c);
  const x = p.at[0]! - q12(mul(cos(c, i), SWEEP.back)) + q12(mul(slide, sin(c, i)));
  const z = p.at[2]! - q12(mul(sin(c, i), SWEEP.back)) - q12(mul(slide, cos(c, i)));
  const facing = angle(c, div(q.at[0]! + p.at[0]!, 2) - x, div(q.at[2]! + p.at[2]!, 2) - z);
  const j = index18((facing - 0x400) * -0x40);
  const ahead = q12(mul(sin(c, j), p.at[0]! - x) + mul(cos(c, j), p.at[2]! - z));
  const tilt = angle(c, ahead, -height);
  writeSlot(c, [x, height, z, ((tilt << 16) >> 10) - 0x1b00, (facing - 0x400) * 0x40, 500], FOLLOW);
}

/** The attract mode's frame: the shot its step names, each restarting the shot's 720 frames; past them, the next of the four. */
function stepAttract(c: Camera, a: Fighter, b: Fighter): void {
  const attract = c.state.camera.attract;
  track(c, a, b, 0);
  let restart = false;
  switch (attract.step - 10) {
    case 0:
      follow(c, a, b, 1, FOLLOW_DISTANCE);
      restart = true;
      break;
    case 1:
      follow(c, a, b, 0, FOLLOW_DISTANCE);
      break;
    case 10:
      sweepShot(c, a, -1);
      restart = true;
      break;
    case 0xb:
    case 0x1f:
      sweepShot(c, a, 0);
      break;
    case 0x14:
      orbit(c, true);
      restart = true;
      break;
    case 0x15:
      orbit(c, false);
      break;
    case 0x1e:
      sweepShot(c, a, -2);
      restart = true;
      break;
    default:
      startAttract(c, a, b);
  }
  if (restart) {
    attract.timer = ATTRACT_SHOT;
    attract.step = s16(attract.step + 1);
  }
  attract.timer = (attract.timer - 1) | 0;
  if (attract.timer < 0) {
    attract.shot = s16(attract.shot + 1);
    attract.step = s16(c.data.camera.attractShots[attract.shot % 4]!);
  }
  useSlot(c, FOLLOW);
}

function startAttract(c: Camera, a: Fighter, b: Fighter): void {
  const attract = c.state.camera.attract;
  attract.shot = s16(attract.shot % 4);
  const step = c.data.camera.attractShots[attract.shot];
  if (step === undefined) throw new Error(`attract shot ${attract.shot}`);
  attract.step = s16(step);
  resetSlots(c, a, b);
}

/* ---- The attract intro's camera: scripts of the intro's moveset played one after another. ---- */

/**
 * The intro's script for a set and an index: set 0 walks the shots from 0x2b two at a time; set 1
 * has one, 0x4b, played about the side whose moveset is 0xe if either's is.
 */
function introScript(c: Camera, set: number, index: number, side: number): ShotRef {
  if (set === 0) return chooseShot(c, 0x2b + index * 2, 0, 0).shot;
  if (set !== 1 || index !== 0) return 0;
  const [a, b] = c.state.fighters;
  if (a.character === 0xe) side = 0;
  else if (b.character === 0xe) side = 1;
  return chooseShot(c, 0x4b, 0, side).shot;
}

/** A script started for the intro: its frames. */
function startIntroScript(c: Camera, shot: ShotRef): number {
  if (!isScript(shot)) throw new Error(`the intro's camera shot ${JSON.stringify(shot)} is not a script`);
  startScript(c, shot);
  return c.state.camera.scriptFrames;
}

/** The intro's shot this frame through slot 2, its script counted down, and when it ends (set 0 only) the set's next script. */
function introShot(c: Camera): number {
  const cam = c.state.camera;
  const intro = cam.intro;
  const progress = scriptPlace(c, true);
  intro.left = s16(intro.left - 1);
  if (0 < intro.left || intro.set === 1) return progress;
  cam.scriptFrame = 0;
  intro.next = (intro.next + 1) & 0xff;
  intro.left = s16(startIntroScript(c, introScript(c, 0, intro.next, 0)));
  stepScript(c, true);
  return progress;
}

/**
 * The attract intro's camera. With 1 or 2 its script set starts (set 0 or 1): the shot marked a
 * script, the weights and origin cleared, scripts scaled to the screen, the first script started,
 * no replay camera. With 0 a frame of it plays through slot 2; returns its progress, or 1 once no
 * script plays.
 */
export function introCamera(state: FightState, data: FightData, kind: number, side = 0): number {
  const c: Camera = { state, data };
  const cam = state.camera;
  if (kind !== 0) {
    const set = kind - 1;
    if (!((set >>> 0) < 2)) return 1;
    cam.intro.next = 0;
    cam.intro.set = set;
    const shot = introScript(c, set, 0, side);
    cam.shotKind = -1;
    cam.weights[SCRIPT] = 0x1000;
    cam.scriptFrame = 0;
    cam.following = 0;
    cam.scriptOrigin.fill(0);
    cam.shotYaw = 0;
    cam.scriptMirror = 0;
    cam.weights[FOLLOW] = 0;
    cam.weights[SHOT] = 0;
    cam.scaleScripts = 1;
    cam.intro.left = s16(startIntroScript(c, shot));
    stepScript(c, true);
    cam.replay.active = 0;
  }
  if (!(cam.shotKind < 0)) return 1;
  cam.shotYaw = 0;
  const progress = introShot(c);
  useSlot(c, SCRIPT);
  return progress;
}

/**
 * The camera set back to following after practice's combo replay: reset, the attract shots and
 * the slots started over about the two fighters (the partner first), no script, the replay's
 * camera off.
 */
export function resetCameraAfterReplay(state: FightState, data: FightData, a: Fighter, b: Fighter): void {
  const c: Camera = { state, data };
  resetCamera(c);
  startAttract(c, a, b);
  resetSlots(c, a, b);
  state.camera.script = null;
  state.camera.replay.active = 0;
}

/**
 * The intro's camera set up: the camera reset, the attract shots and slots started over, a script
 * set started (`kind` 1 the intro's first, 2 Ogre's change's).
 */
export function startIntroCamera(state: FightState, data: FightData, kind = 1): void {
  const c: Camera = { state, data };
  const [a, b] = state.fighters;
  resetCamera(c);
  startAttract(c, a, b);
  resetSlots(c, a, b);
  introCamera(state, data, kind);
}

/* ---- Tekken Force's camera. ---- */

/**
 * Tekken Force's camera: its eye high behind the street, MISHIMA FORTRESS's view rolled; the
 * player's place across the picture past which it moves (five millimetres for each unit over),
 * the window it moves in both ways within, how far the pitch steps as the player rises or drops
 * past the picture's band, and the pitch's range.
 */
const FORCE_CAMERA = { y: -3500, z: -7000, pitch: 0x2aaa, screen: 500, fortress: 3, fortressRoll: 0x82, push: 5, window: 5000, leftEdge: -100, rightEdge: 0x3c, depth: 2500, step: 0x2d8, high: 0xd5, low: 0xbc, most: 0x10000 } as const;
/** How the camera follows: only to the right, still, both ways within its window. */
export const ForceCameraMode = { RIGHT: 0, STILL: 1, WINDOW: 2 } as const;

/** Tekken Force's camera told how to follow (the window set about where it stands). */
export function setForceCameraMode(state: FightState, mode: number): void {
  const f = state.camera.force;
  if (mode === ForceCameraMode.RIGHT) f.rightEdge = 1;
  if (mode === ForceCameraMode.WINDOW) {
    f.leftEdge = FORCE_CAMERA.leftEdge;
    f.rightEdge = FORCE_CAMERA.rightEdge;
    f.min = f.x - FORCE_CAMERA.window;
    f.max = f.x + FORCE_CAMERA.window;
  }
  f.mode = mode;
}

/** Tekken Force's camera at a stage's start. */
function forceCameraStart(c: Camera): void {
  const cam = c.state.camera;
  const f = cam.force;
  cam.drawn.roll = c.state.match.stage === FORCE_CAMERA.fortress ? FORCE_CAMERA.fortressRoll : 0;
  Object.assign(f, { x: 0, y: FORCE_CAMERA.y, z: FORCE_CAMERA.z, pitch: FORCE_CAMERA.pitch, yaw: 0, screen: FORCE_CAMERA.screen, pitchTarget: FORCE_CAMERA.pitch, xTarget: 0, mode: ForceCameraMode.RIGHT, rightEdge: 1 });
  f.origin = f.x;
}

/**
 * A frame of Tekken Force's camera: the player's root seen from the eye (the view's roll undone),
 * its place across the picture moving the eye toward the side it is on (never left while it only
 * follows right; held to its window while it follows both ways), and its height on the picture
 * stepping the pitch to keep it in the picture's band, eased and held to its range.
 */
function forceCameraFrame(c: Camera): void {
  const cam = c.state.camera;
  const f = cam.force;
  const root = c.state.fighters[0].skeleton.base.translation;
  const p = shr(-f.pitch, 6) & 0xfff;
  const r = -cam.drawn.roll & 0xfff;
  const dx = root[0]! - f.x;
  const dz = root[2]! - f.z;
  const x1 = q12(mul(cos(c, r), dx) + mul(sin(c, r), f.y));
  const y1 = q12(mul(sin(c, r), dx) + mul(cos(c, r), -f.y));
  const depth = q12(mul(cos(c, p), dz) - mul(sin(c, p), y1));
  const vertical = q12(mul(sin(c, p), dz) + mul(cos(c, p), y1));
  const up = cpuDiv(cpuDiv(mul(vertical, FORCE_CAMERA.depth), depth), 3);
  const across = cpuDiv(mul(x1, FORCE_CAMERA.screen), depth);
  f.xTarget = f.x;
  if (f.mode === ForceCameraMode.RIGHT) {
    if (f.rightEdge < across) f.xTarget = f.x + (across - f.rightEdge) * FORCE_CAMERA.push;
  } else if (f.mode === ForceCameraMode.WINDOW) {
    if (across < f.leftEdge) f.xTarget = f.x - (f.leftEdge - across) * FORCE_CAMERA.push;
    if (f.rightEdge < across) f.xTarget = f.x + (across - f.rightEdge) * FORCE_CAMERA.push;
  }
  if ((0 < across && f.x < f.xTarget) || (across < 0 && f.xTarget < f.x)) f.x = f.xTarget;
  if (f.mode === ForceCameraMode.WINDOW) f.x = Math.min(Math.max(f.x, f.min), f.max);
  if (FORCE_CAMERA.high <= up) f.pitchTarget = f.pitch + FORCE_CAMERA.step;
  else if (up < FORCE_CAMERA.low) f.pitchTarget = f.pitch - FORCE_CAMERA.step;
  if (f.pitch !== f.pitchTarget) f.pitch -= div(f.pitch - f.pitchTarget, 8);
  f.pitch = Math.min(Math.max(f.pitch, FORCE_CAMERA.pitch), FORCE_CAMERA.most);
  writeSlot(c, [f.x, f.y, f.z, f.pitch, f.yaw, f.screen], FOLLOW);
  useSlot(c, FOLLOW);
}

/* ---- The frame. ---- */

/**
 * A frame of the fight's camera, by the match's status: set up, the opening sweep blending into
 * the follow camera, the fight (following, with shots for throws, moves and scenes), and the
 * knockout and finishing shots.
 */
export function stepCamera(state: FightState, data: FightData): void {
  const c: Camera = { state, data };
  const [a, b] = state.fighters;
  const cam = state.camera;
  cam.lockedOn = lockedOn(c);
  const mode = state.attract !== 0 ? ATTRACT : state.mode;
  if (mode === Mode.TEKKEN_FORCE) {
    if (state.status === 0) {
      resetCamera(c);
      startAttract(c, a, b);
      resetSlots(c, a, b);
      cam.script = null;
      cam.replay.active = 0;
      forceCameraStart(c);
      state.status = 2;
    } else if (state.status !== 2) return;
    forceCameraFrame(c);
    return;
  }
  if (mode === ATTRACT) {
    if (cam.attractStarted === 0) {
      resetCamera(c);
      startAttract(c, a, b);
      resetSlots(c, a, b);
      cam.script = null;
      cam.replay.active = 0;
      cam.attractStarted = 1;
    } else if (cam.attractStarted !== 1) {
      cam.attractStarted = 0;
      return;
    }
    stepAttract(c, a, b);
    return;
  }
  if (state.status === 0) {
    resetCamera(c);
    startAttract(c, a, b);
    resetSlots(c, a, b);
    cam.script = null;
    cam.replay.active = 0;
    startOpening(c, a, b);
    cam.shot = -1;
    stopScript(c);
    state.status = 1;
  }
  switch (state.status) {
    case 1:
      if (cam.following !== 0) {
        track(c, a, b, 0);
        cam.shot = -1;
        stopScript(c);
        const sweep = stepOpening(c);
        cam.weights[FOLLOW] = s16(0x1000 - sweep);
        cam.weights[SCRIPT] = s16(sweep);
        if (0 < s16(0x1000 - sweep)) follow(c, a, b, cam.lastWeights[FOLLOW]! < 1 ? 1 : 0, FOLLOW_DISTANCE);
        blend(c);
        if (!(0 < cam.weights[SCRIPT]!)) {
          cam.state = 1;
          state.status = 2;
        }
      }
      break;
    case 2:
      if (cam.following === 0) return;
      fight(c, a, b);
      break;
    case 3:
    case 4:
      state.shake = null;
      startKnockout(c, state.status === 3 ? a : b, state.status === 3 ? 0 : 1);
      state.status = 5;
      stepKnockout(c);
      break;
    case 5:
      stepKnockout(c);
      break;
    case 6:
    case 7: {
      state.shake = null;
      const f = state.status === 6 ? a : b;
      stepFinish(c, f, f.health === 0 ? 1 : 0);
      break;
    }
  }
}

/** The fight's camera through its states: following, a shot starting, playing, handing back, a script, a scene. */
function fight(c: Camera, a: Fighter, b: Fighter): void {
  const cam = c.state.camera;
  track(c, a, b, 0);
  if ((cam.watched === 0 && a.throwHold === 0) || (cam.watched === 1 && b.throwHold === 0)) cam.watched = -1;
  const throwing = (): boolean => (cam.focus === 0 ? throwShotDone(c, a, b) : cam.focus === 1 && throwShotDone(c, b, a));
  const [first, second] = trackedPair(c);
  const third = cam.tracked[2]!;
  const nearer = (): boolean => (first.screenX === second.screenX ? third.screenX < cam.lastTracked[0]!.screenX : first.screenX < second.screenX);
  const ratio = (left: number, length: number): number => s16(div(left << 12, length));
  switch (cam.state - 1) {
    case 0: {
      cam.shot = -1;
      cam.left = -1;
      cam.sceneLength = -1;
      if (cam.shotsAllowed === 0) break;
      const ta = a.throwHold;
      if (cam.watched < 0 && (0 < ta || 0 < b.throwHold)) {
        cam.focus = ta < 1 ? 1 : 0;
        let side = nearer() ? 0 : 1;
        if (ta < 1) side = 1 - side;
        cam.mirrored = side;
        cam.sceneLength = -1;
        cam.watched = cam.focus;
        const length = startMoveShot(c, a, b, cam.focus, cam.mirrored);
        if (length < 0) cam.shot = -1;
        else {
          if (cam.shotKind < 0) {
            cam.state = 6;
            cam.countdown = -1;
          } else {
            aimShot(c, a, b);
            cam.countdown = 0x10;
            cam.state = 3;
          }
          cam.left = s16(length);
          cam.length = s16(length);
        }
      } else {
        const who = chooseScene(c, a, b);
        if (-1 < who) {
          cam.focus = who;
          let side = nearer() ? 0 : 1;
          if (who !== 0) side = 1 - side;
          cam.mirrored = side;
          const length = startScene(c);
          if (-1 < length && -1 < cam.shotKind) {
            cam.state = 8;
            const scene = sceneOf(c);
            cam.sceneLeft = s16(scene.hold - scene.close);
            cam.sceneLength = cam.sceneLeft;
          }
          cam.left = s16(length);
          cam.length = s16(length);
        }
      }
      break;
    }
    case 1:
      cam.weights[SHOT] = 0x1000;
      cam.weights[SCRIPT] = 0;
      cam.weights[FOLLOW] = 0;
      if (throwing()) {
        const length = s16(exitLength(c));
        cam.state = 4;
        cam.left = length;
        cam.length = length;
      }
      break;
    case 2:
      if (cam.countdown < 0) {
        cam.weights[FOLLOW] = ratio(cam.left, cam.length);
        cam.weights[SHOT] = s16(0x1000 - cam.weights[FOLLOW]!);
        if (throwing()) {
          cam.left = s16(exitLength(c));
          cam.length = cam.left;
          if (cam.weights[SHOT] === 0) {
            cam.state = 1;
            break;
          }
          if (cam.weights[FOLLOW] === 0) cam.state = 4;
          else {
            cam.weights[HELD] = 0x1000;
            cam.weights[SHOT] = 0;
            cam.weights[FOLLOW] = 0;
            cam.state = 5;
            holdSlot(c, BLENDED);
          }
        } else {
          cam.left = s16(cam.left - 1);
          if (cam.left < 0) cam.state = 2;
        }
      } else {
        let cut = cameraByte(c, a) === 9;
        if (!cut) {
          cam.countdown = s16(cam.countdown - 1);
          cut = cameraByte(c, b) === 9;
        }
        if (cut) {
          cam.shot = -1;
          cam.countdown = -1;
          cam.state = 1;
        }
      }
      break;
    case 3: {
      const left = cam.left;
      cam.left = s16(left - 1);
      cam.weights[SHOT] = ratio(left, cam.length);
      cam.weights[FOLLOW] = s16(0x1000 - cam.weights[SHOT]!);
      if (cam.left < 0) {
        cam.length = -1;
        cam.left = -1;
        cam.state = 1;
      }
      break;
    }
    case 4: {
      const left = cam.left;
      cam.left = s16(left - 1);
      cam.weights[HELD] = ratio(left, cam.length);
      cam.weights[FOLLOW] = s16(0x1000 - cam.weights[HELD]!);
      if (cam.left < 0) cam.state = 1;
      break;
    }
    case 5: {
      let restart = 0;
      if (cam.scriptRestart === 0) {
        if (cam.countdown === -1) {
          restart = 1;
          cam.countdown = -2;
        }
      } else {
        cam.countdown = -3;
        cam.scriptRestart = 0;
      }
      const progress = moveShot(c, a, b, restart, FOLLOW_DISTANCE, cam.focus);
      if (progress < 0) return;
      cam.weights[SHOT] = 0;
      cam.weights[FOLLOW] = s16(div(progress << 12, SCRIPT_END));
      cam.weights[SCRIPT] = s16(0x1000 - cam.weights[FOLLOW]!);
      if (cameraByte(c, a) === 9 || cameraByte(c, b) === 9) {
        exitLength(c);
        cam.length = 8;
        cam.left = 8;
        if (progress === SCRIPT_END) cam.state = 1;
        else {
          cam.weights[HELD] = 0x1000;
          cam.weights[SCRIPT] = 0;
          cam.weights[FOLLOW] = 0;
          cam.state = 5;
          holdSlot(c, BLENDED);
        }
        cam.countdown = -1;
        cam.shot = -1;
      } else if ((cam.focus === 0 && a.throwHold < 0) || (cam.focus === 1 && b.throwHold < 0)) {
        cam.length = 0x23;
        cam.left = 0x23;
        cam.weights[HELD] = 0x1000;
        cam.weights[SCRIPT] = 0;
        cam.weights[FOLLOW] = 0;
        cam.state = 5;
        holdSlot(c, BLENDED);
        cam.countdown = -1;
        cam.shot = -1;
      } else if (cam.countdown === -2 && progress === 0) cam.countdown = -3;
      else if (cam.countdown === -3 && progress === SCRIPT_END) {
        cam.left = s16(exitLength(c));
        cam.state = 1;
        cam.countdown = -1;
        cam.length = cam.left;
        cam.script = null;
      }
      break;
    }
    case 7:
      cam.weights[SHOT] = 0x1000;
      cam.weights[SCRIPT] = 0;
      cam.weights[FOLLOW] = 0;
      cam.sceneLeft = s16(cam.sceneLeft - 1);
      if (cam.sceneLeft < 1) {
        cam.sceneLength = -1;
        cam.state = 1;
        cam.weights[FOLLOW] = 0x1000;
        cam.weights[SCRIPT] = 0;
        cam.weights[SHOT] = 0;
        cam.length = -1;
        cam.left = -1;
      }
      break;
    default:
      resetCamera(c);
  }
  if (0 < cam.weights[SHOT]!) {
    if (cam.sceneLength < 0) moveShot(c, a, b, cam.lastWeights[SHOT]! < 1 ? 1 : 0, FOLLOW_DISTANCE, cam.focus);
    else sceneShot(c, a, b, cam.lastWeights[SHOT]! < 1 ? 1 : 0, FOLLOW_DISTANCE);
  }
  if (0 < cam.weights[FOLLOW]!) follow(c, a, b, cam.lastWeights[FOLLOW]! < 1 ? 1 : 0, FOLLOW_DISTANCE);
  blend(c);
}

/** A camera shake (0 light, 1 heavy, 2 the heaviest) started from its list's first step. */
export function startShake(state: FightState, kind: number): void {
  state.shake = { kind, at: 0 };
}

/** A camera shake's frame: its list's next step added to the drawn view's pitch; the list's end stops it. */
export function stepShake(state: FightState, data: FightData): void {
  const shake = state.shake;
  if (shake === null) return;
  let step = data.effects.shakes[shake.kind]![shake.at]!;
  shake.at += 1;
  if (step === SHAKE_END) {
    state.shake = null;
    step = 0;
  }
  state.camera.drawn.pitch = (state.camera.drawn.pitch + step) | 0;
}

/**
 * The view matrix from a drawn view: Rx(-pitch) · Ry(-yaw) · Rz(-roll), its middle row scaled by
 * 0x1bd2/0x1000 for the interlaced screen's pixel shape, and the translation that puts the eye at
 * the origin.
 */
export function viewMatrix(data: Pick<FightData, 'math'>, view: CameraView, out: Matrix): void {
  const roll = -view.roll & 0xfff;
  const yaw = -view.yaw & 0xfff;
  const pitch = -view.pitch & 0xfff;
  const sr = sine(data.math, roll);
  const cr = cosine(data.math, roll);
  const local = [cr, -sr, 0, sr, cr, 0, 0, 0, 0x1000];
  const sy = sine(data.math, yaw);
  const cy = cosine(data.math, yaw);
  const m = out.rotation;
  [cy, 0, -sy, 0, 0x1000, 0, sy, 0, cy].forEach((v, i) => (m[i] = v));
  multiplyInto(m, local);
  const sp = sine(data.math, pitch);
  const cp = cosine(data.math, pitch);
  multiply([0x1000, 0, 0, 0, cp, sp, 0, -sp, cp], m, m);
  for (const i of [3, 4, 5]) m[i] = s16(q12(mul(m[i]!, 0x1bd2)));
  const x = -view.eye[0]!;
  const y = -view.eye[1]!;
  const z = -view.eye[2]!;
  for (let row = 0; row < 3; row += 1) out.translation[row] = (mul(m[row * 3]!, x) + mul(m[row * 3 + 1]!, y) + mul(m[row * 3 + 2]!, z)) >> 12;
}
