/**
 * The disc's XA songs as the drive decodes them, a sector at a time (a song file: 'XA', the coding
 * byte, a spare byte, the song's first sector, then 2304 bytes a sector).
 *
 * A sector's audio is 18 sound groups of 128 bytes: sixteen bytes of parameters (each unit's
 * filter and range at `4 + unit`), then 28 words each holding one sample of every unit. At four
 * bits a group has eight units of 28 samples, a byte's low nibble the even unit and its high the
 * odd; in stereo the even units are the left channel and the odd the right. A sample is its nibble
 * shifted up by 12 less the range, plus the last two samples weighed by the filter's pair (64ths),
 * held to 16 bits; each channel keeps its last two from group to group and sector to sector.
 */

/** The filters' weights for the last sample and the one before, in 64ths. */
const POSITIVE = [0, 60, 115, 98];
const NEGATIVE = [0, 0, -52, -55];
const SECTOR_AUDIO = 18 * 128;
const HEADER = 8;
/** A channel's samples a sector: 18 groups of eight units of 28, halved in stereo. */
export const SECTOR_SAMPLES = 18 * 8 * 28;

export class XaSong {
  /** Samples a second (37 800 or 18 900), and whether the song is stereo. */
  readonly rate: number;
  readonly stereo: boolean;
  readonly sectors: number;
  private readonly bytes: Uint8Array;
  private next = 0;
  private readonly last = [0, 0];
  private readonly before = [0, 0];

  constructor(bytes: Uint8Array) {
    if (bytes[0] !== 0x58 || bytes[1] !== 0x41) throw new Error('not an XA song');
    const coding = bytes[2]!;
    if ((coding & 0x30) === 0x10) throw new Error('8-bit XA is not used by the game');
    this.bytes = bytes;
    this.stereo = (coding & 3) === 1;
    this.rate = (coding & 0xc) === 4 ? 18900 : 37800;
    this.sectors = Math.floor((bytes.length - HEADER) / SECTOR_AUDIO);
  }

  /** Back to the song's start, as the drive seeks it. */
  rewind(): void {
    this.next = 0;
    this.last.fill(0);
    this.before.fill(0);
  }

  /** Whether every sector has been decoded. */
  get ended(): boolean {
    return this.next >= this.sectors;
  }

  /**
   * The next sector into `left` and `right` (each `SECTOR_SAMPLES` long; a mono song's into both),
   * returning how many samples a channel it gave: 0 past the end.
   */
  decodeSector(left: Int16Array, right: Int16Array): number {
    if (this.ended) return 0;
    const bytes = this.bytes;
    const written = [0, 0];
    const out = [left, right];
    for (let group = 0; group < 18; group += 1) {
      const at = HEADER + this.next * SECTOR_AUDIO + group * 128;
      for (let unit = 0; unit < 8; unit += 1) {
        const c = this.stereo ? unit & 1 : 0;
        const parameter = bytes[at + 4 + unit]!;
        let range = parameter & 0xf;
        if (range > 12) range = 9;
        const shift = 12 - range;
        const filter = (parameter >> 4) & 3;
        const channel = out[c]!;
        let older = this.before[c]!;
        let old = this.last[c]!;
        for (let j = 0; j < 28; j += 1) {
          const byte = bytes[at + 16 + (unit >> 1) + j * 4]!;
          const nibble = (((unit & 1) === 0 ? byte & 0xf : byte >> 4) << 28) >> 28;
          let sample = (nibble << shift) + ((old * POSITIVE[filter]! + older * NEGATIVE[filter]! + 32) >> 6);
          if (sample > 0x7fff) sample = 0x7fff;
          else if (sample < -0x8000) sample = -0x8000;
          channel[written[c]!] = sample;
          written[c] = written[c]! + 1;
          older = old;
          old = sample;
        }
        this.before[c] = older;
        this.last[c] = old;
      }
    }
    this.next += 1;
    if (!this.stereo) right.set(left.subarray(0, written[0]));
    return written[0]!;
  }
}
