/**
 * An audio track's byte order. A disc's audio is 16-bit stereo samples, little-endian in a BIN
 * image; some ripping tools (cdrdao's `read-cd`) write them big-endian. Music read in its own order
 * moves little from one sample to the next, and read in the other order it jumps about, so the
 * order whose steps are smaller is the track's.
 */
import { closeSync, openSync, readSync, writeSync } from 'node:fs';

const SECTOR = 2352;

/** The mean step between successive samples of one channel, read little- or big-endian. */
function meanStep(bytes, bigEndian) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  let count = 0;
  for (let i = 4; i + 1 < bytes.length; i += 4) {
    sum += Math.abs(view.getInt16(i, !bigEndian) - view.getInt16(i - 4, !bigEndian));
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Whether `bytes` (whole stereo samples) read better big-endian: true or false where one order is
 * clearly smoother, null where the stretch is too quiet to tell.
 */
export function bigEndianAudio(bytes) {
  const little = meanStep(bytes, false);
  const big = meanStep(bytes, true);
  if (little + big < 64) return null;
  if (big * 2 < little) return true;
  if (little * 2 < big) return false;
  return null;
}

/**
 * Checks each audio track of the image at `imagePath` (`tracks`: number, start and end sectors)
 * and swaps the bytes of every sample of those written big-endian, in place. Returns the numbers of
 * the tracks swapped.
 */
export function fixAudioOrder(imagePath, tracks) {
  const fd = openSync(imagePath, 'r+');
  const swapped = [];
  try {
    for (const track of tracks) {
      /* Votes from stretches across the track, a second each, skipping the quiet ones. */
      const stretch = Buffer.alloc(75 * SECTOR);
      let big = 0;
      let little = 0;
      const sectors = track.end - track.start;
      for (let k = 1; k <= 9; k += 1) {
        const at = track.start + Math.floor((sectors * k) / 10);
        const n = readSync(fd, stretch, 0, Math.min(stretch.length, (track.end - at) * SECTOR), at * SECTOR);
        const vote = bigEndianAudio(stretch.subarray(0, n - (n % 4)));
        if (vote === true) big += 1;
        else if (vote === false) little += 1;
      }
      if (big <= little) continue;
      const chunk = Buffer.alloc(1024 * SECTOR);
      for (let at = track.start; at < track.end; at += 1024) {
        const length = Math.min(1024, track.end - at) * SECTOR;
        readSync(fd, chunk, 0, length, at * SECTOR);
        chunk.subarray(0, length).swap16();
        writeSync(fd, chunk, 0, length, at * SECTOR);
      }
      swapped.push(track.number);
    }
  } finally {
    closeSync(fd);
  }
  return swapped;
}
