/**
 * How long a voice sounds, as the fight needs to know it: whether a voice keyed on some frames ago
 * is still keyed and sounding. A voice's envelope rises from silence (attack), falls to its sustain
 * level (decay) and holds there or keeps falling (sustain); its waveform plays at its pitch, 28
 * samples a block, and on reaching a block marked as its end either repeats from its loop or falls
 * silent at once. The sound chip steps both 44100 times a second, 735 times a frame; a voice keyed
 * on at a frame's start has begun its attack by the time the fight asks.
 *
 * This is the envelope's and the waveform's arithmetic, not their sound: the presentation plays the
 * sounds as it likes.
 */
import type { SoundBank, SoundBanks, Tone } from '../data/banks.ts';
import type { FightData, FightState } from './state.ts';

/** Chip steps a frame. */
export const TICKS_PER_FRAME = 735;

/** An envelope phase's stepping: a rate (a shift, two bits up, and a step), rising or falling, linear or exponential. */
interface Envelope {
  counter: number;
  rate: number;
  still: number;
  decreasing: boolean;
  exponential: boolean;
}

const Phase = { OFF: 0, ATTACK: 1, DECAY: 2, SUSTAIN: 3, RELEASE: 4 } as const;

const clamp16 = (v: number): number => (v < -0x8000 ? -0x8000 : v > 0x7fff ? 0x7fff : v);

/** The level after a step. */
function step(envelope: Envelope, level: number): number {
  const shift = envelope.rate >> 2;
  let delta = 7 - (envelope.rate & 3);
  if (envelope.decreasing) delta = ~delta;
  delta <<= Math.max(0, 11 - shift);
  let increment = 0x8000 >> Math.max(0, shift - 11);
  if (envelope.exponential && !envelope.decreasing && level > 0x6000) {
    if (shift < 10) delta >>= 2;
    else if (shift >= 11) increment >>= 2;
    else {
      delta >>= 1;
      increment >>= 1;
    }
  } else if (envelope.exponential && envelope.decreasing) delta = (delta * level) >> 15;
  if (envelope.rate !== envelope.still) increment = Math.max(increment, 1);
  envelope.counter += increment;
  if ((envelope.counter & 0x8000) === 0) return level;
  envelope.counter = 0;
  level += delta;
  return envelope.decreasing ? Math.max(level, 0) : clamp16(level);
}

/** A phase's envelope from the tone's two envelope words. */
function phaseEnvelope(phase: number, adsr1: number, adsr2: number): Envelope {
  const envelope = (rate: number, still: number, decreasing: boolean, exponential: boolean): Envelope => ({ counter: 0, rate, still, decreasing, exponential });
  switch (phase) {
    case Phase.ATTACK:
      return envelope((adsr1 >> 8) & 0x7f, 0x7f, false, (adsr1 & 0x8000) !== 0);
    case Phase.DECAY:
      return envelope(((adsr1 >> 4) & 0xf) << 2, -1, true, true);
    case Phase.SUSTAIN:
      return envelope((adsr2 >> 6) & 0x7f, 0x7f, (adsr2 & 0x4000) !== 0, (adsr2 & 0x8000) !== 0);
    default:
      return envelope((adsr2 & 0x1f) << 2, 0x7c, true, (adsr2 & 0x20) !== 0);
  }
}

/** A voice's envelope as the chip steps it, from its key-on: its phase, its level and the phase's stepping. */
export interface VoiceEnvelope {
  phase: number;
  level: number;
  envelope: Envelope;
}

/** A voice's envelope at its key-on: silent, rising. */
export function keyedEnvelope(tone: Tone): VoiceEnvelope {
  return { phase: Phase.ATTACK, level: 0, envelope: phaseEnvelope(Phase.ATTACK, tone.adsr1, tone.adsr2) };
}

/** A tick of the chip: the level stepped, and on to the next phase where this one ends (attack at full, decay at the sustain level, release at silence). */
export function tickEnvelope(v: VoiceEnvelope, tone: Tone): void {
  if (v.phase === Phase.OFF) return;
  v.level = step(v.envelope, v.level);
  if (v.phase === Phase.ATTACK && v.level >= 0x7fff) v.envelope = phaseEnvelope((v.phase = Phase.DECAY), tone.adsr1, tone.adsr2);
  else if (v.phase === Phase.DECAY && v.level <= Math.min(((tone.adsr1 & 0xf) + 1) * 0x800, 0x7fff)) v.envelope = phaseEnvelope((v.phase = Phase.SUSTAIN), tone.adsr1, tone.adsr2);
  else if (v.phase === Phase.RELEASE && v.level <= 0) {
    v.phase = Phase.OFF;
    v.level = 0;
  }
}

/** Keyed off: on into the release from where it is; or with `cut` (its waveform ended and does not repeat) silent at once. */
export function releaseEnvelope(v: VoiceEnvelope, tone: Tone, cut = false): void {
  v.envelope = phaseEnvelope((v.phase = Phase.RELEASE), tone.adsr1, tone.adsr2);
  if (cut) v.level = 0;
}

/** Whether the envelope has fallen silent for good: off, or released all the way down. */
export const envelopeOff = (v: VoiceEnvelope): boolean => v.phase === Phase.OFF || (v.phase === Phase.RELEASE && v.level === 0);

/**
 * Whether a tone keyed on at `pitch` is still sounding after `ticks` of the chip: its envelope
 * not yet back at silence.
 */
export function soundingAfter(tone: Tone, flags: readonly number[], pitch: number, ticks: number): boolean {
  const v = keyedEnvelope(tone);
  let block = 0;
  let counter = 0;
  let repeat: number | null = null;
  const flagsAt = (b: number): number => {
    const f = flags[b];
    if (f === undefined) throw new Error(`a waveform played past its ${flags.length} blocks`);
    if ((f & 4) !== 0) repeat = b;
    return f;
  };
  let current = flagsAt(0);
  const stepSize = pitch > 0x3fff ? 0x4000 : pitch;
  for (let t = 0; t < ticks; t += 1) {
    tickEnvelope(v, tone);
    if (envelopeOff(v)) return false;
    counter += stepSize;
    while (counter >> 12 >= 28) {
      counter -= 28 << 12;
      if ((current & 1) !== 0) {
        if (repeat === null) throw new Error('a waveform repeats from a loop it never marked');
        if ((current & 2) === 0) releaseEnvelope(v, tone, true);
        block = repeat;
      } else block += 1;
      current = flagsAt(block);
    }
    if (envelopeOff(v)) return false;
  }
  return v.level !== 0;
}

/** A tone's pitch for a note (its own note playing at 0x1000), as the sound library works it out. */
export function noteToPitch(banks: Pick<SoundBanks, 'pitches'>, tone: Pick<Tone, 'centre' | 'fine'>, note: number, fine: number): number {
  let sixteenths = (fine & 0xffff) + tone.fine;
  if (sixteenths < 0) sixteenths += 7;
  sixteenths >>= 3;
  let carry = 0;
  if (0x10 <= sixteenths) {
    carry = 1;
    sixteenths -= 0x10;
  }
  const n = ((note + 0x3c - tone.centre + carry) << 16) >> 16;
  const octave = Math.trunc(n / 12);
  const semitone = n - octave * 12;
  let pitch = banks.pitches[semitone * 0x10 + sixteenths];
  if (pitch === undefined) throw new Error(`no pitch for semitone ${semitone}`);
  const shift = octave - 5;
  if (0 < shift) pitch <<= shift;
  else if (shift < 0) pitch >>= -shift;
  return pitch & 0xffff;
}

/** The bank a voice's bank number names: the effects' two, the Theater's in VAB 2 when it opened it, or the fighter's bank loaded there. */
function bankOf(state: FightState, data: FightData, bank: number): SoundBank | undefined {
  if (bank < 2) return data.banks.effects[bank];
  if (bank === 2 && state.sound.theater !== 0) return data.banks.theater;
  const id = state.sound.vabs[bank];
  return id === undefined ? undefined : data.banks.fighters[id];
}

/** Whether a voice is keyed on and still sounding as the fight asks this frame. */
export function voiceSounding(state: FightState, data: FightData, voice: number): boolean {
  const v = state.sound.voices[voice];
  if (v === undefined || v.keyed === 0) return false;
  const ticks = TICKS_PER_FRAME * ((state.frameCount - v.keyedAt) | 0);
  if (ticks <= 0) return true;
  const bank = bankOf(state, data, v.bank);
  if (bank === undefined) throw new Error(`voice ${voice} plays bank ${v.bank}, which is not loaded`);
  const tone = bank.tones[bank.firstTones[v.program]! * 16 + v.tone];
  if (tone === undefined) throw new Error(`voice ${voice} plays a tone bank ${v.bank} does not have`);
  return soundingAfter(tone, bank.vags[tone.vag]!, noteToPitch(data.banks, tone, v.note, 0), ticks);
}
