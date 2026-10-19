/**
 * The display's frames as the 60 Hz loop counts them. A frame whose time since the last lies
 * within half a millisecond of a whole number of half fields (1/120 s) counts as exactly that, a
 * hair over, so a 60 Hz display runs a field every frame and a 120 Hz one every other frame,
 * evenly: counted as they come, two frames of a 120 Hz display add up to a field or fall a hair
 * short of one as their times wander, and the fields come one, two or three frames apart. Frames
 * at other rates (90 Hz, 144 Hz) keep their own times. At GAME SPEED's 50 Hz the frames' times count
 * five sixths, so the 60 Hz loop runs fifty fields a second, as a PAL console does.
 */
import type { FrameSource } from '@driftengine/core';

/** Half a field, milliseconds. */
const HALF_FIELD_MS = 1000 / 120;
/** How far from a whole number of half fields a frame's time is taken as one. */
const TOLERANCE_MS = 0.5;
/** Added to a snapped time, so whole half fields never fall short of a field by rounding. */
const OVER_MS = 1e-6;

/** The share of the loop's 60 fields a second that GAME SPEED's 50 Hz runs. */
export const FIFTY_HZ = 50 / 60;

/** A frame's time since the last, milliseconds, as the loop counts it. */
export function evenTime(ms: number): number {
  const halves = Math.round(ms / HALF_FIELD_MS);
  return halves >= 1 && Math.abs(ms - halves * HALF_FIELD_MS) < TOLERANCE_MS ? halves * HALF_FIELD_MS + OVER_MS : ms;
}

/** A frame's time as the loop counts it with the game running at `pace` of its 60 fields a second. */
export const pacedTime = (ms: number, pace: number): number => evenTime(ms) * pace;

/** The browser's animation frames, stamped with times counted by `pacedTime` at the pace `pace` gives each frame. */
export function evenFrames(pace: () => number = () => 1): FrameSource {
  let raw: number | null = null;
  let even = 0;
  return {
    requestAnimationFrame: (callback) =>
      requestAnimationFrame((now) => {
        even = raw === null ? now : even + pacedTime(now - raw, pace());
        raw = now;
        callback(even);
      }),
    cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
  };
}

/** The frames a very low page weighs (a second and a half of sixty), and the most their mean may be for sixty a second (fifty and more held). */
const PACE_WINDOW = 90;
const FULL_MS = 20;

/**
 * A very low page's pictures a second: sixty while its fight's frames keep up, thirty from the first
 * second and a half (`PACE_WINDOW` frames) they come more than `FULL_MS` apart on the mean with the
 * picture already at its least density, for the rest of the start: an even thirty rather than a
 * picture that stutters between them; the fields run sixty a second either way.
 */
export class VeryLowPace {
  /** Whether it draws thirty pictures a second. */
  half = false;
  private readonly window: number[] = [];

  /**
   * A drawn frame `ms` after the last: `counted`, a fight's frame after no wait; `least`, the
   * picture at its least density. Whether it has just gone to thirty.
   */
  sample(ms: number, counted: boolean, least: boolean): boolean {
    if (this.half || !counted) return false;
    if (!least) {
      this.window.length = 0;
      return false;
    }
    this.window.push(ms);
    if (this.window.length > PACE_WINDOW) this.window.shift();
    if (this.window.length < PACE_WINDOW || this.window.reduce((sum, one) => sum + one, 0) / PACE_WINDOW <= FULL_MS) return false;
    this.half = true;
    return true;
  }
}
