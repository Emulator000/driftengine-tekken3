/**
 * A voice as the sound library keys it and the chip plays it: a tone of a bank's program at a note,
 * its pitch from the note against the tone's own through the pitch table, its volume the command's,
 * the bank's, the program's and the tone's, mono; its waveform played at its pitch (cubic
 * interpolation where the chip's is Gaussian), its envelope stepped as the chip steps it a tick at
 * a time (the simulation's own stepping, so a voice falls silent where the simulation times it), its
 * loop repeated, and at a waveform's end without one silent at once.
 */
import { envelopeOff, keyedEnvelope, noteToPitch, releaseEnvelope, tickEnvelope, type VoiceEnvelope } from '../../sim/fight/voice-timing.ts';
import type { PlayableBank, PlayableBanks, PlayableTone, Waveform } from './banks.ts';

/** The chip's ticks a second: a voice's pitch of 0x1000 plays a sample a tick. */
export const CHIP_RATE = 44100;

const s8 = (v: number): number => (v << 24) >> 24;

/** A volume of 0 to 0x7f taken from one side by a pan of 0 to 0x7f, 0x40 the middle. */
function pan(left: number, right: number, by: number): [number, number] {
  if (by < 0x40) return [left, Math.floor((right * by) / 63)];
  return [Math.floor((left * (0x7f - by)) / 63), right];
}

/** The chip's voice volume (0 to 0x3fff) a key-on at `volume` (of 127) sets: the bank's, program's and tone's volumes over 127 each, their pans, mono (the louder side). */
export function keyVolume(bank: PlayableBank, program: number, tone: PlayableTone, volume: number): number {
  let level = Math.trunc((s8(volume) * (bank.volume * 0x3fff)) / 0x3f01);
  level = Math.trunc((Math.imul(Math.imul(level, s8(bank.programs[program]!.volume)), s8(tone.volume)) >>> 0) / 0x3f01);
  let [left, right] = pan(level, level, tone.pan);
  [left, right] = pan(left, right, bank.programs[program]!.pan);
  return Math.max(left, right);
}

export class Voice {
  readonly tone: PlayableTone;
  private readonly samples: Int16Array;
  private readonly wave: Waveform;
  /** Samples a tick, and the voice's gain (its chip volume, doubled into the chip's level, over 0x8000). */
  private readonly step: number;
  private readonly gain: number;
  private readonly envelope: VoiceEnvelope;
  private position = 0;

  constructor(bank: PlayableBank, tone: PlayableTone, pitch: number, volume: number) {
    this.tone = tone;
    this.samples = bank.pcm;
    this.wave = bank.waveforms[tone.vag]!;
    this.step = Math.min(pitch, 0x4000) / 0x1000;
    this.gain = (((volume << 1) << 16) >> 16) / 0x8000;
    this.envelope = keyedEnvelope(tone);
  }

  /** Keyed off: into its release. */
  release(): void {
    releaseEnvelope(this.envelope, this.tone);
  }

  /** Whether it has fallen silent for good. */
  get done(): boolean {
    return envelopeOff(this.envelope);
  }

  /** A tick: the sample it sounds (-1 to 1, its envelope and volume applied), then on by its pitch. */
  tick(): number {
    const envelope = this.envelope;
    tickEnvelope(envelope, this.tone);
    if (envelopeOff(envelope)) return 0;
    const out = (this.at(this.position) * envelope.level * this.gain) / (0x8000 * 0x8000);
    this.position += this.step;
    const { length, loop } = this.wave;
    if (length <= this.position) {
      if (0 <= loop && loop < length) {
        while (length <= this.position) this.position -= length - loop;
      } else {
        releaseEnvelope(envelope, this.tone, true);
        this.position = length;
      }
    }
    return out;
  }

  /** The waveform at a place between its samples (Catmull-Rom over the two either side; silence past its ends). */
  private at(position: number): number {
    const i = Math.floor(position);
    const t = position - i;
    const { offset, length } = this.wave;
    const s = (k: number): number => (k < 0 || length <= k ? 0 : this.samples[offset + k]!);
    const a = s(i - 1);
    const b = s(i);
    const c = s(i + 1);
    const d = s(i + 2);
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
}

/** A key-on's voice: the slot's bank's tone of `program` at `note` and `volume`, or null where the bank has no such tone or waveform. */
export function keyOn(banks: PlayableBanks, bank: PlayableBank, program: number, tone: number, note: number, volume: number): Voice | null {
  const first = bank.programs[program]?.firstTone;
  if (first === undefined) return null;
  const record = bank.tones[s8(tone) + first * 16];
  if (record === undefined || record.vag === 0 || bank.waveforms[record.vag] === undefined) return null;
  return new Voice(bank, record, noteToPitch(banks, record, note, 0), keyVolume(bank, program, record, volume));
}
