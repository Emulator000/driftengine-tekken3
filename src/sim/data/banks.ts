/**
 * The sound banks as the fight times voices by them: a bank's tones (the note each plays at, its
 * fine tune, its envelope's two words, its waveform) and its waveforms' block flags (bit 0 the
 * waveform's end, bit 1 to repeat from its loop, bit 2 the loop's start); each program's first
 * tone. A tone is its program's first tone times sixteen plus the tone.
 */
export interface Tone {
  readonly centre: number;
  readonly fine: number;
  readonly adsr1: number;
  readonly adsr2: number;
  readonly vag: number;
}

export interface SoundBank {
  readonly firstTones: readonly number[];
  readonly tones: readonly Tone[];
  readonly vags: readonly (readonly number[])[];
}

export interface SoundBanks {
  /** The pitch of each semitone's sixteenths, 0x1000 a tone's own note. */
  readonly pitches: readonly number[];
  readonly effects: readonly SoundBank[];
  /** The fighters' banks by sound bank. */
  readonly fighters: Readonly<Record<number, SoundBank>>;
  /** The Theater's own bank, which it opens as VAB 2 for the credits. */
  readonly theater: SoundBank;
}
