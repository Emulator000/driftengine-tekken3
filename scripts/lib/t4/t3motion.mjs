/**
 * Tekken 3's motion format, written (`src/motion/motion.ts` reads it): a frame count in the first
 * byte, then a byte per channel saying how many words its data takes, and the data from byte 50,
 * each value half what the game uses (it doubles them).
 *
 * A channel is written in the plainest form that holds it exactly: none for all zeros, one word for
 * a constant, a start and a slope for two frames, else a value per frame, the odd channels' frames
 * reversed as the game reads them. The keyframed curves the game's own motions use are not written.
 */

const CHANNELS = 49;

/** A motion from its frames, each the 49 channel values as the game uses them. */
export function encodeT3Motion(frames) {
  const count = frames.length;
  if (count < 1 || count > 0xff) throw new Error(`a Tekken 3 motion holds 1 to 255 frames, not ${count}`);
  const channels = [];
  for (let c = 0; c < CHANNELS; c += 1) {
    const values = frames.map((frame) => halve(frame[c]));
    if (c & 1) values.reverse();
    if (values.every((v) => v === 0)) channels.push([]);
    else if (values.every((v) => v === values[0])) channels.push([values[0]]);
    else if (count === 2) channels.push([values[0], values[1] - values[0]]);
    else channels.push(values);
  }
  const words = channels.reduce((sum, data) => sum + data.length, 0);
  const out = new Uint8Array(50 + words * 2);
  const view = new DataView(out.buffer);
  out[0] = count;
  channels.forEach((data, c) => (out[1 + c] = data.length));
  let at = 50;
  for (const data of channels) {
    for (const v of data) {
      view.setInt16(at, v, true);
      at += 2;
    }
  }
  return out;
}

/** Half a value, as the signed 16-bit word the game doubles back. */
function halve(v) {
  const r = Math.round(v / 2);
  if (r < -0x8000 || r > 0x7fff) throw new Error(`a motion value ${v} does not fit 16 bits once halved`);
  return r;
}
