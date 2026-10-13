/**
 * The fight's sounds as commands: each voice keyed on with a sound (its bank, program, tone, note
 * and volume) or keyed off, in the order the fight asks for them, for the presentation to play.
 * Codes and effects are as `SoundTables` describes them. The sound is mono: one volume a voice.
 *
 * Banks: 0 and 1 are the effects' two; 2 and 3 hold the fighters' own, whichever the match loaded
 * each side's into (`sound.fighterBanks`).
 */
import { s16 } from '../math/integers.ts';
import type { FightData, FightState } from './state.ts';

/**
 * A voice keyed on with a sound, or keyed off; the music faded to a volume (of 127) over some
 * frames, or ended once faded; a song played (or with `next` only readied). And what a movie asks
 * of the music driver and the drive: the song's volume set as it is (the movie's), the driver's
 * state (5 and 6 a movie playing, 1 stopped, 7 the drive read on through a span), the span (the
 * drive's place, and the end it reads on to), the movie's file read from a sector, the drive paused.
 */
export type SoundCommand =
  | { readonly key: 'on'; readonly voice: number; readonly bank: number; readonly program: number; readonly tone: number; readonly note: number; readonly volume: number }
  | { readonly key: 'off'; readonly voice: number }
  | { readonly key: 'music fade'; readonly volume: number; readonly frames: number }
  | { readonly key: 'music end after fade' }
  | { readonly key: 'music stop' }
  | { readonly key: 'song'; readonly song: number; readonly next: boolean }
  | { readonly key: 'song volume'; readonly volume: number }
  | { readonly key: 'music mode'; readonly mode: number }
  | { readonly key: 'music span'; readonly start: number; readonly end: number }
  | { readonly key: 'movie read'; readonly sector: number }
  | { readonly key: 'drive pause' }
  | { readonly key: 'music reset' }
  | { readonly key: 'music options'; readonly set: number; readonly stereo: number }
  | { readonly key: 'theater song'; readonly song: number; readonly set: number }
  | { readonly key: 'reverb'; readonly voices: number; readonly depth: number }
  | { readonly key: 'at'; readonly vblank: number };

/** Mokujin's roster id: he plays his own codes for some effects. */
const MOKUJIN = 0xf;

/** A voice keyed off (voices past 23 are asked for and play nothing). */
export function keyOff(state: FightState, voice: number): void {
  state.sound.commands.push({ key: 'off', voice });
}

/** A voice keyed off then on with a code's sound, at a volume. */
function keyOn(state: FightState, voice: number, bank: number, code: number, volume: number): void {
  keyOff(state, voice);
  state.sound.commands.push({ key: 'on', voice, bank, program: (code & 0x30) >> 4, tone: code & 0xf, note: (code & 0xf) + 0x3c, volume });
}

/** Effect `id` (its low twelve bits) on its own voice. */
export function effect(state: FightState, data: Pick<FightData, 'sound'>, id: number): void {
  const code = data.sound.effects[s16(id & 0xfff)];
  if (code === undefined) throw new Error(`effect ${id & 0xfff} is past the effects' table`);
  if ((code & 0xc000) === 0) return;
  keyOn(state, (code >> 10) & 0xf, ((code & 0xc000) >> 14) - 1, code, data.sound.volumes[(code >> 6) & 0xf]!);
}

/** Mokujin's code for a code, if he has one for it (a sign-extended code matches none). */
export function mokujinSound(data: Pick<FightData, 'sound'>, code: number): number {
  for (const { effect, code: own } of data.sound.mokujin) if (code === data.sound.effects[effect]) return own;
  return code;
}

/**
 * A code played for a side (1 at most): its bank the fighter's own for bank 3; its voice the side's
 * for voices past 5, or with flags bit 7 one of the last eight; its volume halved `flags & 0x1f`
 * times. Mokujin plays his own codes.
 */
export function voiceLine(state: FightState, data: Pick<FightData, 'sound'>, side: number, code: number, flags: number): void {
  if (1 < side) side = 1;
  const index = state.fighters[side]!.movesetSlot;
  if (state.fighters[index]!.roster === MOKUJIN) code = mokujinSound(data, code);
  const bank = code & 0xc000;
  if (bank === 0) return;
  const vab = bank === 0xc000 ? state.sound.fighterBanks[index]! : (bank >> 14) - 1;
  let voice = (code >> 10) & 0xf;
  if ((flags & 0x80) === 0) {
    if (5 < voice) voice += index;
  } else voice += 0x10;
  keyOn(state, voice, vab, code, data.sound.volumes[(code >> 6) & 0xf]! >> (flags & 0x1f));
}

/** The voice a code plays on keyed off (the side's for voices past 5). */
export function lineOff(state: FightState, side: number, code: number): void {
  if (1 < side) side = 1;
  if ((code & 0xc000) === 0) return;
  let voice = (code & 0x3c00) >> 10;
  if (5 < voice) voice += side;
  keyOff(state, voice);
}

/** Song `song` played, or with `next` readied to play when asked for without. */
export function playSong(state: FightState, song: number, next: boolean): void {
  state.sound.commands.push({ key: 'song', song, next });
}

/** The Theater's music player's song: its pick from `set` (0 the arrangement's, 1 the arcade's), played once from its start. */
export function playTheaterSong(state: FightState, song: number, set: number): void {
  state.sound.commands.push({ key: 'theater song', song, set });
}

/** The song's volume (of 127) set as it is: a movie's, from its record. */
export function setSongVolume(state: FightState, volume: number): void {
  state.sound.commands.push({ key: 'song volume', volume });
}

/** The music driver's state set: 5 and 6 while a movie plays, 1 stopped, 7 reading a movie's file on to its span's end. */
export function musicMode(state: FightState, mode: number): void {
  state.sound.commands.push({ key: 'music mode', mode });
}

/** The drive's place and the span it reads on to (sectors in the XA file), not to loop. */
export function musicSpan(state: FightState, start: number, end: number): void {
  state.sound.commands.push({ key: 'music span', start, end });
}

/** A movie's file read from `sector` (in the XA file) on, its sound the movie's. */
export function readMovie(state: FightState, sector: number): void {
  state.sound.commands.push({ key: 'movie read', sector });
}

/**
 * The Theater's sound: the fighters' banks closed and its own opened as VAB 2 for the first side's
 * sounds (no fighter's bank in VAB 2 or 3), and the reverb on, the Room's at a depth of 0x1fff,
 * for voice 1.
 */
export function theaterSound(state: FightState): void {
  const sound = state.sound;
  sound.fighterBanks[0] = 2;
  sound.vabs[3] = 0xff;
  sound.vabs[2] = 0xff;
  sound.theater = 1;
  sound.reverb = 1;
  sound.commands.push({ key: 'reverb', voices: 2, depth: 0x1fff });
}

/** The reverb off, as a match loads after a scene left it on. */
export function reverbOff(state: FightState): void {
  if (state.sound.reverb === 0) return;
  state.sound.reverb = 0;
  state.sound.commands.push({ key: 'reverb', voices: 0, depth: 0 });
}

/** The drive paused, as a movie stops. */
export function pauseDrive(state: FightState): void {
  state.sound.commands.push({ key: 'drive pause' });
}

/** The music faded to `volume` (of 127) over `frames`. */
export function fadeMusic(state: FightState, volume: number, frames: number): void {
  state.sound.commands.push({ key: 'music fade', volume, frames });
}

/** After a won match: the music down to `volume` over three seconds, then ended. */
export function musicAfterWin(state: FightState, volume: number): void {
  fadeMusic(state, volume, 0xb4);
  state.sound.commands.push({ key: 'music end after fade' });
}

/** The music's driver reset: its volume back to full and its song stopped. */
export function resetMusic(state: FightState): void {
  state.sound.commands.push({ key: 'music reset' });
}

/** The music stopped (no song is left playing, though the driver may already have stopped it). */
export function stopMusic(state: FightState): void {
  state.sound.commands.push({ key: 'music stop' });
}

/** The music stopped and every voice keyed off (but the fourth with `keepFourth`). */
export function stopSounds(state: FightState, keepFourth: boolean): void {
  stopMusic(state);
  for (let voice = 0; voice < 0x18; voice += 1) if (!keepFourth || voice !== 3) keyOff(state, voice);
}

/** Every voice keyed off but 2 and 3, and with `spare` also 1, 6 and 7. */
export function keyOffVoices(state: FightState, spare: boolean): void {
  for (let voice = 0; voice < 0x18; voice += 1) {
    if (voice === 3 || voice === 2) continue;
    if (spare && ((voice - 6) >>> 0 < 2 || voice === 1)) continue;
    keyOff(state, voice);
  }
}
