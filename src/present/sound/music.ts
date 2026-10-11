/**
 * The music driver as the presentation runs it, from the same commands as the simulation's (and to
 * the same records, `src/sim/sound/music.ts`): what it says plays (the XA song from its start each
 * time it starts, the audio track, the movie's sound while the drive reads it) at its gains.
 */
import type { SoundCommand } from '../../sim/fight/voices.ts';
import { musicCommand, musicFrame, musicGains, musicPosition, musicTick, newMusic, type MusicState, type MusicTables } from '../../sim/sound/music.ts';

export type { MusicTables, SongPick } from '../../sim/sound/music.ts';

export class MusicDriver {
  private readonly tables: MusicTables;
  private readonly state: MusicState;

  constructor(tables: MusicTables) {
    this.tables = tables;
    this.state = newMusic();
  }

  /** A frame's music command, in the frame's order. */
  command(c: SoundCommand): void {
    musicCommand(this.state, this.tables, c);
  }

  /** A field: the drive reads on. */
  tick(): void {
    musicTick(this.state);
  }

  /** A frame's start, before its commands. */
  field(): void {
    musicFrame(this.state, this.tables);
  }

  /** The CD's gain each side to its own and across, 0 to 1. */
  gains(): { same: number; across: number } {
    return musicGains(this.state, this.tables);
  }

  /** The song playing (-1 none), its XA song (-1 none), how many times it started from its start, whether it loops. */
  get song(): number {
    return this.state.song;
  }
  get xa(): number {
    return this.state.xa;
  }
  get starts(): number {
    return this.state.starts;
  }
  get loops(): boolean {
    return this.state.loops;
  }

  /** The audio track the drive plays (0 none) and how far into it (in fields). */
  get track(): number {
    return this.state.track;
  }
  get trackFields(): number {
    return this.state.trackFields;
  }

  /** The driver's state. */
  get mode(): number {
    return this.state.mode;
  }

  /** The music's volume as the driver keeps it (of 127). */
  get level(): number {
    return this.state.volume;
  }

  /** The XA song's place on the disc, as the drive reports it. */
  get position(): number {
    return musicPosition(this.state, this.tables);
  }

  /** Whether the drive reads a movie's file (its sound the movie's). */
  get readingMovie(): boolean {
    return 0 <= this.state.movieFrom;
  }
}
