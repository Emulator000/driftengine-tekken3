/**
 * The sound banks as the presentation plays them (`sound/banks.json` and each bank's PCM): what the
 * sound library keys a voice by, and every waveform decoded from the chip's ADPCM.
 */

/** A tone: its mode, volume and pan (of 127, 64 the middle), its own note and fine tune, its envelope's two words, its waveform. */
export interface PlayableTone {
  readonly mode: number;
  readonly volume: number;
  readonly pan: number;
  readonly centre: number;
  readonly fine: number;
  readonly adsr1: number;
  readonly adsr2: number;
  readonly vag: number;
}

/** A waveform's place in its bank's PCM, its length and where its loop starts (-1 when it does not repeat). */
export interface Waveform {
  readonly offset: number;
  readonly length: number;
  readonly loop: number;
}

/** A bank: its volume, its programs (first tone, volume, pan), its tones, its waveforms and their samples. */
export interface PlayableBank {
  readonly volume: number;
  readonly programs: readonly { readonly firstTone: number; readonly volume: number; readonly pan: number }[];
  readonly tones: readonly PlayableTone[];
  readonly waveforms: readonly Waveform[];
  readonly pcm: Int16Array;
}

/** The pitch table (each semitone's sixteenths, 0x1000 a tone's own note), the effects' two banks and the fighters' by sound bank. */
export interface PlayableBanks {
  readonly pitches: readonly number[];
  readonly effects: readonly PlayableBank[];
  readonly fighters: Readonly<Record<number, PlayableBank>>;
  /** The Theater's own bank, which it opens as VAB 2 for the credits. */
  readonly theater: PlayableBank;
}
