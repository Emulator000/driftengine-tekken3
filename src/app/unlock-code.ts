/**
 * The title's code for everything the game unlocks, for a game with no address to add `?unlock`
 * to (the apps): 0 pressed five times on the title within three seconds, or the title tapped five
 * times, any other key starting the count over. It earns what the game's last unlock does, with a
 * challenger's arrival's sound.
 */
import { voiceLine } from '../sim/fight/voices.ts';
import type { GameData } from '../sim/game/game.ts';
import { applySchedule } from '../sim/game/records.ts';
import type { GameState } from '../sim/game/state.ts';

/** The unlock schedule's steps, its last earning everything. */
export const UNLOCK_STEPS = 14;
/** The presses the code takes, and the milliseconds they are made within. */
const PRESSES = 5;
const WITHIN = 3000;
/** The sound of a challenger's arrival. */
const CHALLENGER_SOUND = 0x49a1;

/** Whether a key pressed is the code's: 0, on the row or the keypad, alone and not repeating. */
export const isUnlockKey = (e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>): boolean =>
  (e.code === 'Digit0' || e.code === 'Numpad0') && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

/** The code's presses counted: the last five within three seconds give it. */
export class UnlockCode {
  private times: number[] = [];

  /** A press at `now` (milliseconds); true when it is the code's fifth, the count then starting over. */
  press(now: number): boolean {
    this.times.push(now);
    if (PRESSES < this.times.length) this.times.shift();
    if (this.times.length < PRESSES || WITHIN < now - this.times[0]!) return false;
    this.times = [];
    return true;
  }

  /** Another key pressed, or the title left: the count starts over. */
  reset(): void {
    this.times = [];
  }
}

/** Everything the game unlocks earned, as its last unlock earns it, with a challenger's arrival's sound. */
export function unlockByCode(game: GameState, data: GameData): void {
  applySchedule(game, data.scenes, UNLOCK_STEPS);
  voiceLine(game.world, data.tables, 0, CHALLENGER_SOUND, 0);
}
