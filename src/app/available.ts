/**
 * Whether a player in ONLINE MODE's waiting room may be offered an opponent: in its fight, playing
 * (not loading it, not in Practice's menu, not paused), the page in sight, and the fight drawn on
 * the screen a second running already, so no offer comes while the versus screen before it, or
 * the dissolve from it, still shows, however long the device takes to show the fight.
 */
import { FightStep } from '../sim/game/fight-scene.ts';
import { Scene, type GameState } from '../sim/game/state.ts';

/** Milliseconds the fight is drawn in a row before its player is available, and the frames that takes at least. */
export const SHOWN_MS = 1000;
export const SHOWN_FRAMES = 10;

export class Available {
  /** When the frames in a row showing the fight began (null while it is not shown), and how many there have been. */
  private since: number | null = null;
  private frames = 0;
  private last = 0;

  /** A frame drawn at `now` (milliseconds): whether it showed the fight, settled (no dissolve over it). */
  drawn(fight: boolean, now: number): void {
    if (!fight) {
      this.since = null;
      this.frames = 0;
      return;
    }
    this.since ??= now;
    this.frames += 1;
    this.last = now;
  }

  /** Whether the player is available now, `inSight` whether the page is. */
  now(state: GameState, inSight: boolean): boolean {
    const shown = this.since !== null && this.last - this.since >= SHOWN_MS && this.frames >= SHOWN_FRAMES;
    return state.online.warming === 2 && state.scene === Scene.FIGHT && state.step === FightStep.FIGHTING && state.practice.paused === 0 && state.world.pause.paused === 0 && inSight && shown;
  }
}
