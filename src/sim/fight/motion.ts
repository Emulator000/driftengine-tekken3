/**
 * A motion's channels at a frame, each doubled, as a fighter is posed from them. Frames before the
 * first read the first, past the last the last.
 */
import type { Channel, CurveTables, Motion } from '../data/motion.ts';

export function sampleMotion(motion: Motion, frame: number, curves: CurveTables, out: Int16Array, count = out.length): void {
  const frames = motion.frames;
  const f = frame < 0 ? 0 : frame >= frames ? frames - 1 : frame;
  for (let c = 0; c < count; c += 1) {
    const channel = motion.channels[c]!;
    out[c] = channelAt(channel, channel.reversed ? frames - (f + 1) : f, frames, curves) << 1;
  }
}

function channelAt(channel: Channel, at: number, frames: number, curves: CurveTables): number {
  switch (channel.kind) {
    case 'zero':
      return 0;
    case 'constant':
      return channel.value;
    case 'linear': {
      /* The slope is per frame, or per 32 frames in a motion longer than nine. */
      const travel = channel.slope * at;
      return channel.start + (frames > 9 ? travel >> 5 : travel);
    }
    case 'samples':
      return channel.values[at]!;
    case 'keys':
      return keyedAt(channel, at, frames, curves);
  }
}

/** Keys: a start value, then steps each reached `span` frames after the one before. */
export interface Keys {
  readonly start: number;
  readonly steps: Int32Array;
  readonly spans: Uint8Array;
}

/**
 * Keys at a frame of `frames`: the segment holding it found by walking the keys, then the cubic
 * through the key before the segment, its two ends and the key after, with tabulated weights. The
 * first segment has no key before it and the last none after; each weighs its ends its own way.
 * The camera's scripts ease their keys the same way.
 */
export function keyedAt(channel: Keys, frame: number, frames: number, curves: CurveTables): number {
  const last = frames - 1;
  let before = channel.start;
  let from = before;
  let after = channel.steps[0]! + before;
  let span = channel.spans[0]!;
  let key = 0;
  let start = 0;
  let end = 0;
  let to = after;
  let at = from;
  let previous = before;
  for (;;) {
    start = end;
    to = after;
    at = from;
    previous = before;
    end = start + span;
    after = to;
    if (end === last) break;
    key += 1;
    after = to + channel.steps[key]!;
    span = channel.spans[key]!;
    before = at;
    from = to;
    if (!(frame - end > 0)) break;
  }
  const f = frame - start;
  const index = f === 0 ? 0 : curves.segment[end - start]![f]!;
  let weightTo: number;
  let sum: number;
  if (start === 0) {
    weightTo = curves.first[index]!;
    sum = Math.imul(curves.after[index]!, after - at);
  } else {
    const back = Math.imul(curves.back[index]!, previous - at);
    if (end === last) {
      weightTo = curves.first[index]! + curves.after[index]! + 0x2aab;
      sum = back;
    } else {
      sum = (Math.imul(curves.after[index]!, after - at) + back) | 0;
      weightTo = curves.next[index]!;
    }
  }
  return (((sum + Math.imul(weightTo, to - at)) | 0) >> 16) + at;
}
