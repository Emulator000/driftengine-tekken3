/**
 * A frame's sound commands at their times: each at the vertical blank its frame's last `at` set
 * (the frame's own before any), as a movie's waits within one frame put its later commands fields
 * on (the ending's movie, played whole inside a frame, reads its file at its start and pauses the
 * drive at its end); handed out once their field comes.
 */
import type { SoundCommand } from '../../sim/fight/voices.ts';

export class TimedCommands {
  private readonly queue: { readonly at: number; readonly command: SoundCommand }[] = [];

  /** A frame's commands, the frame having started at vertical blank `start`. */
  add(commands: readonly SoundCommand[], start: number): void {
    let at = start;
    for (const c of commands) {
      if (c.key === 'at') at = c.vblank;
      else this.queue.push({ at, command: c });
    }
  }

  /** The commands due by vertical blank `now`, in their order. */
  due(now: number): SoundCommand[] {
    let n = 0;
    while (n < this.queue.length && this.queue[n]!.at <= now) n += 1;
    return this.queue.splice(0, n).map((e) => e.command);
  }
}
