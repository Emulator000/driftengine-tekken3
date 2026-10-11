/**
 * The game's sound mixed for the speakers, at the chip's rate: its 24 voices keyed on and off by
 * each field's commands (in their order, so the last key-on of a voice wins, as at the chip's
 * flush), the fighters' banks found in the slots the match loaded them into, and the music its
 * driver plays, read a sector at a time and resampled to the chip's rate. The chip sums its voices
 * and the drive's music at full main and CD volume and clips; here the sum is limited softly instead.
 */
import type { SoundCommand } from '../../sim/fight/voices.ts';
import type { PlayableBank, PlayableBanks } from './banks.ts';
import { MusicDriver, type MusicTables } from './music.ts';
import { CHIP_RATE, keyOn, type Voice } from './voices.ts';
import { SECTOR_SAMPLES, XaSong } from './xa.ts';
import { TimedCommands } from './timed.ts';

/** The voices the game keys (it asks for more and they play nothing). */
const VOICES = 24;
/** The music's samples kept decoded ahead of and behind where it plays. */
const RING = 1 << 14;
/** Where the soft limit starts, of full scale. */
const KNEE = 0.85;

/** The slot number the player sends for VAB 2 while it holds the Theater's own bank. */
export const THEATER_SLOT = 0x100;

/**
 * A room's reverb for the voices the game puts through the chip's (only the Theater's credits
 * sound, at a depth of 0x1fff): four combs into two all-passes each side (Schroeder's), sized for a
 * small room at the chip's rate. Not the chip's own: its Room preset's taps are the library's.
 */
class Room {
  private readonly combs: { buffer: Float32Array; at: number; filtered: number }[][];
  private readonly passes: { buffer: Float32Array; at: number }[][];
  constructor() {
    const comb = (n: number) => ({ buffer: new Float32Array(n), at: 0, filtered: 0 });
    const pass = (n: number) => ({ buffer: new Float32Array(n), at: 0 });
    this.combs = [[1116, 1188, 1277, 1356].map(comb), [1139, 1211, 1300, 1379].map(comb)];
    this.passes = [[556, 441].map(pass), [579, 464].map(pass)];
  }

  /** A sample in, each side's reverb out. */
  next(input: number, out: [number, number]): void {
    for (let side = 0; side < 2; side += 1) {
      let sum = 0;
      for (const c of this.combs[side]!) {
        const delayed = c.buffer[c.at]!;
        c.filtered = delayed * 0.6 + c.filtered * 0.4;
        c.buffer[c.at] = input + c.filtered * 0.72;
        c.at = (c.at + 1) % c.buffer.length;
        sum += delayed;
      }
      let y = sum / 4;
      for (const p of this.passes[side]!) {
        const delayed = p.buffer[p.at]!;
        p.buffer[p.at] = y + delayed * 0.5;
        p.at = (p.at + 1) % p.buffer.length;
        y = delayed - y;
      }
      out[side] = y;
    }
  }
}

/** Full scale past the knee bent toward 1 and never past it. */
function limit(x: number): number {
  const m = Math.abs(x);
  if (m <= KNEE) return x;
  const over = (m - KNEE) / (1 - KNEE);
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh(over));
}

/** A song read a sector at a time into a ring, played at its rate against the chip's from its start; silent past its last sector (its driver starts it over or stops it). */
class SongPlayer {
  private readonly song: XaSong;
  private readonly ring = [new Float32Array(RING), new Float32Array(RING)];
  private readonly sector = [new Int16Array(SECTOR_SAMPLES), new Int16Array(SECTOR_SAMPLES)];
  private readonly step: number;
  /** Samples decoded so far (from the start, counting on through its loops), and the place it plays (in samples). */
  private written = 0;
  private position = 0;

  constructor(bytes: Uint8Array) {
    this.song = new XaSong(bytes);
    this.step = this.song.rate / CHIP_RATE;
  }

  /** The next sample each side (-1 to 1), or null past its last sector. */
  next(): [number, number] | null {
    const i = Math.floor(this.position);
    this.fill(i + 2);
    if (this.written <= i) return null;
    const t = this.position - i;
    const out: [number, number] = [0, 0];
    for (let c = 0; c < 2; c += 1) {
      const ring = this.ring[c]!;
      const s = (k: number): number => (k < 0 || this.written <= k ? 0 : ring[k & (RING - 1)]!);
      const a = s(i - 1);
      const b = s(i);
      const d1 = s(i + 1);
      const d2 = s(i + 2);
      out[c] = b + 0.5 * t * (d1 - a + t * (2 * a - 5 * b + 4 * d1 - d2 + t * (3 * (b - d1) + d2 - a)));
    }
    this.position += this.step;
    return out;
  }

  /** Sectors decoded until sample `upTo` is, or the song has none left. */
  private fill(upTo: number): void {
    while (this.written <= upTo && !this.song.ended) {
      const count = this.song.decodeSector(this.sector[0]!, this.sector[1]!);
      for (let k = 0; k < count; k += 1) {
        this.ring[0]![(this.written + k) & (RING - 1)] = this.sector[0]![k]! / 0x8000;
        this.ring[1]![(this.written + k) & (RING - 1)] = this.sector[1]![k]! / 0x8000;
      }
      this.written += count;
    }
  }
}

export class Mixer {
  private readonly banks: PlayableBanks;
  private readonly voices: (Voice | null)[] = new Array<Voice | null>(VOICES).fill(null);
  /** The fighters' banks in slots 2 and 3, as the match loaded them. */
  private fighterSlots: (PlayableBank | undefined)[] = [];
  readonly music: MusicDriver;
  /** The commands not yet due, and the field last told. */
  private readonly timed = new TimedCommands();
  private fields = 0;
  /** Each XA song's bytes as they arrive, by its number; the song playing and the start it was made for. */
  private readonly songs = new Map<number, Uint8Array>();
  /** Each audio track's samples as they arrive (left and right interleaved, at the chip's rate), the track playing (0 none) and the next sample of it. */
  private readonly tracks = new Map<number, Int16Array>();
  private trackPlaying = 0;
  private trackAt = 0;
  /** The voices the reverb takes (a bit each) and its depth (of 0x8000), and the reverb. */
  private reverbVoices = 0;
  private reverbDepth = 0;
  private readonly room = new Room();
  private readonly wet: [number, number] = [0, 0];
  private player: SongPlayer | null = null;
  private playing = { xa: -1, start: -1 };
  /** The music's gains as heard, eased toward the driver's each sample so a field's step does not click. */
  private same = 0;
  private across = 0;

  constructor(banks: PlayableBanks, music: MusicTables) {
    this.banks = banks;
    this.music = new MusicDriver(music);
  }

  /** An XA song's bytes, to play when its driver asks for it. */
  song(xa: number, bytes: Uint8Array): void {
    this.songs.set(xa, bytes);
  }

  /** An audio track's samples, to play when the driver asks for it. */
  track(track: number, samples: Int16Array): void {
    this.tracks.set(track, samples);
  }

  /**
   * A field (vertical blank `vblank`): the drive's tick, the music's step if a frame of the game ran,
   * then the commands due, in order (a frame's own, those a movie's waits put on to this field);
   * `vabs` the fighters' banks in each slot.
   */
  field(commands: readonly SoundCommand[], vabs: readonly number[], frameRan = true, vblank = this.fields + 1): void {
    this.fields = vblank;
    this.fighterSlots = vabs.map((id) => (id === THEATER_SLOT ? this.banks.theater : this.banks.fighters[id]));
    this.music.tick();
    if (frameRan) this.music.field();
    this.timed.add(commands, vblank);
    for (const c of this.timed.due(vblank)) {
      if (c.key === 'off') this.voices[c.voice]?.release();
      else if (c.key === 'on') {
        if (VOICES <= c.voice) continue;
        const bank = c.bank < 2 ? this.banks.effects[c.bank] : this.fighterSlots[c.bank];
        this.voices[c.voice] = bank === undefined ? null : keyOn(this.banks, bank, c.program, c.tone, c.note, c.volume);
      } else if (c.key === 'reverb') {
        this.reverbVoices = c.voices;
        this.reverbDepth = c.depth;
      } else this.music.command(c);
    }
  }

  /** The next samples into `left` and `right`; `cd` the movie's sound, left and right, when the drive reads a movie (the CD input then, at the music's gains). */
  render(left: Float32Array, right: Float32Array, cd?: readonly [Float32Array, Float32Array]): void {
    this.followSong();
    const { same, across } = this.music.gains();
    const movie = cd !== undefined && this.music.readingMovie ? cd : null;
    if (this.music.track !== this.trackPlaying) {
      this.trackPlaying = this.music.track;
      this.trackAt = 0;
    }
    const samples = this.trackPlaying === 0 ? undefined : this.tracks.get(this.trackPlaying);
    const depth = this.reverbDepth / 0x8000;
    for (let n = 0; n < left.length; n += 1) {
      let voices = 0;
      let send = 0;
      for (let v = 0; v < VOICES; v += 1) {
        const voice = this.voices[v];
        if (voice === null || voice === undefined) continue;
        const sample = voice.tick();
        voices += sample;
        if (((this.reverbVoices >> v) & 1) !== 0) send += sample;
        if (voice.done) this.voices[v] = null;
      }
      let l = voices;
      let r = voices;
      if (this.reverbVoices !== 0) {
        this.room.next(send, this.wet);
        l += this.wet[0] * depth;
        r += this.wet[1] * depth;
      }
      this.same += (same - this.same) * 0.002;
      this.across += (across - this.across) * 0.002;
      if (this.player !== null) {
        const music = this.player.next();
        if (music === null) this.player = null;
        else {
          l += music[0] * this.same + music[1] * this.across;
          r += music[1] * this.same + music[0] * this.across;
        }
      } else if (movie !== null) {
        const ml = movie[0][n] ?? 0;
        const mr = movie[1][n] ?? 0;
        l += ml * this.same + mr * this.across;
        r += mr * this.same + ml * this.across;
      } else if (samples !== undefined && this.trackAt + 1 < samples.length) {
        /* The audio track straight into the CD input, from its start as the drive plays it. */
        const tl = samples[this.trackAt]! / 0x8000;
        const tr = samples[this.trackAt + 1]! / 0x8000;
        l += tl * this.same + tr * this.across;
        r += tr * this.same + tl * this.across;
        this.trackAt += 2;
      }
      left[n] = limit(l);
      right[n] = limit(r);
    }
  }

  /** The player made for the song the driver plays, from its start each time it starts, once its bytes are in. */
  private followSong(): void {
    const { xa, starts } = this.music;
    if (xa < 0) {
      this.player = null;
      this.playing = { xa: -1, start: -1 };
      return;
    }
    if (this.playing.xa === xa && this.playing.start === starts) return;
    const bytes = this.songs.get(xa);
    if (bytes === undefined) return;
    this.player = new SongPlayer(bytes);
    this.playing = { xa, start: starts };
  }
}
