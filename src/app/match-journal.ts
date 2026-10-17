/**
 * An online match's fields as it played them, kept until each is final (the other side's words for
 * it in, so no rollback can change it): each field's sound as the game made it, sent only then, in
 * order and once, so a sound a rollback puts right is never heard wrong (a hit the guess missed
 * heard, a voice not cut by one the guess played); and whether a fighter lay knocked out in it, the
 * picture held while the field the knockout came in is not final, so a knockout a word still to come
 * takes back is never seen. A field played again in a rollback is kept as played again.
 */
import type { SoundCommand } from '../sim/fight/voices.ts';

/** A field's sound as the game made it: its commands, the banks in its slots, whether its frame ran, and its vertical blank. */
export interface FieldSound {
  readonly sound: { readonly commands: readonly SoundCommand[]; readonly vabs: readonly number[]; readonly theater: number };
  readonly frameRan: number;
  readonly vblank: number;
}

export class MatchJournal {
  private readonly sounds = new Map<number, FieldSound>();
  private readonly down = new Map<number, boolean>();
  /** The last field whose sound was given out, and the newest field played. */
  private sent = -1;
  private newest = -1;

  /** A field played (or played again): its sound, and whether a fighter lay knocked out in it. */
  note(field: number, sound: FieldSound, down: boolean): void {
    this.sounds.set(field, sound);
    this.down.set(field, down);
    this.newest = field;
  }

  /** The sound of each field not given out yet that is final now (`final` the newest final field), in order, each once. */
  finalSounds(final: number): FieldSound[] {
    const last = Math.min(final, this.newest);
    const out: FieldSound[] = [];
    for (let field = this.sent + 1; field <= last; field += 1) {
      const sound = this.sounds.get(field);
      if (sound !== undefined) out.push(sound);
      this.sounds.delete(field);
    }
    this.sent = Math.max(this.sent, last);
    for (const field of this.down.keys()) if (field < last - 1) this.down.delete(field);
    return out;
  }

  /** Whether the newest field has a fighter knocked out whose knockout came in a field not final yet. */
  holding(final: number): boolean {
    if (this.down.get(this.newest) !== true) return false;
    let first = this.newest;
    while (this.down.get(first - 1) === true) first -= 1;
    return final < first;
  }
}
