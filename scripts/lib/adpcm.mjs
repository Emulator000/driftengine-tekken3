/**
 * Sony's sound ADPCM (the SPU's and the SPU2's, alike): 16-byte blocks, the first byte a block's
 * shift (bits 0 to 3) and filter (4 to 6), the second its flags (bit 0 the sample's end, bit 1
 * repeat, bit 2 the loop's start), then 28 four-bit samples, low nibble first. A sample is its
 * nibble shifted up by 12 less the shift, plus the last two samples weighed by the filter's pair
 * (64ths), held to 16 bits.
 */

const POSITIVE = [0, 60, 115, 98, 122];
const NEGATIVE = [0, 0, -52, -55, -60];

const clamp16 = (v) => (v < -0x8000 ? -0x8000 : v > 0x7fff ? 0x7fff : v);

/** The samples of the blocks from `at`, to the block flagged as the end (included), or to `end`. */
export function decodeAdpcm(bytes, at = 0, end = bytes.length) {
  const out = [];
  let old = 0;
  let older = 0;
  for (let block = at; block + 16 <= end; block += 16) {
    const shift = bytes[block] & 0xf;
    const filter = Math.min((bytes[block] >> 4) & 7, 4);
    for (let i = 0; i < 28; i += 1) {
      const byte = bytes[block + 2 + (i >> 1)];
      const nibble = (((i & 1) === 0 ? byte & 0xf : byte >> 4) << 28) >> 28;
      const sample = clamp16(((nibble << 12) >> shift) + ((old * POSITIVE[filter] + older * NEGATIVE[filter] + 32) >> 6));
      out.push(sample);
      older = old;
      old = sample;
    }
    if ((bytes[block + 1] & 1) !== 0) break;
  }
  return Int16Array.from(out);
}

/**
 * Samples encoded as the SPU's ADPCM in Tekken 3's layout: a silent block, the samples from a block
 * flagged as the loop's start, the last flagged as the end, then a silent block looping on itself.
 * Each block takes the filter and shift whose decoding comes nearest, carrying the decoder's state.
 */
export function encodeAdpcm(samples) {
  const blocks = Math.ceil(samples.length / 28) || 1;
  const out = new Uint8Array((blocks + 2) * 16);
  let old = 0;
  let older = 0;
  for (let b = 0; b < blocks; b += 1) {
    const chunk = Array.from({ length: 28 }, (_, i) => samples[b * 28 + i] ?? 0);
    let best = null;
    for (let filter = 0; filter < 5; filter += 1) {
      for (let shift = 0; shift <= 12; shift += 1) {
        let o = old;
        let oo = older;
        let error = 0;
        const nibbles = [];
        for (const target of chunk) {
          const predicted = (o * POSITIVE[filter] + oo * NEGATIVE[filter] + 32) >> 6;
          let nibble = Math.round(((target - predicted) * (1 << shift)) / 4096);
          nibble = Math.max(-8, Math.min(7, nibble));
          const decoded = clamp16(((nibble << 12) >> shift) + predicted);
          error += (decoded - target) ** 2;
          nibbles.push(nibble & 0xf);
          oo = o;
          o = decoded;
        }
        if (best === null || error < best.error) best = { error, filter, shift, nibbles, old: o, older: oo };
      }
    }
    const at = (b + 1) * 16;
    out[at] = (best.filter << 4) | best.shift;
    out[at + 1] = (b === 0 ? 4 : 0) | (b === blocks - 1 ? 1 : 0);
    for (let i = 0; i < 14; i += 1) out[at + 2 + i] = best.nibbles[i * 2] | (best.nibbles[i * 2 + 1] << 4);
    old = best.old;
    older = best.older;
  }
  out[(blocks + 1) * 16 + 1] = 7;
  return out;
}

/**
 * Samples from one rate to another through a windowed sinc, low-passed below the lower rate's
 * half (a Blackman window, 32 taps a side).
 */
export function resample(samples, from, to) {
  const ratio = from / to;
  const cutoff = Math.min(1, to / from) * 0.95;
  const taps = 32;
  const length = Math.floor(samples.length / ratio);
  const out = new Int16Array(length);
  for (let n = 0; n < length; n += 1) {
    const centre = n * ratio;
    const first = Math.ceil(centre - taps / cutoff);
    const last = Math.floor(centre + taps / cutoff);
    let sum = 0;
    let weights = 0;
    for (let k = first; k <= last; k += 1) {
      const x = (k - centre) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = (k - centre) / (taps / cutoff);
      const window = Math.abs(w) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
      const weight = sinc * window * cutoff;
      weights += weight;
      if (k >= 0 && k < samples.length) sum += samples[k] * weight;
    }
    out[n] = clamp16(Math.round(weights !== 0 ? sum / weights : 0));
  }
  return out;
}
