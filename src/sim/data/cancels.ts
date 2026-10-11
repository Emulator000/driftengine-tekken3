/**
 * The cancel tables: the shared cancel lists a moveset's lists call into, and the motion kinds (lists
 * of motion ids) a reaction test checks the opponent's motion against.
 */
import type { Cancel } from './moveset.ts';

export interface CancelTables {
  readonly shared: readonly Cancel[];
  readonly motionKinds: readonly (readonly number[])[];
}
