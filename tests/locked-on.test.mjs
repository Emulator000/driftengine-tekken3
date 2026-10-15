/** The fighter the camera holds, as the presentation asks for it: none before the fight's first field, when no move plays yet. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blankFightState } from '../src/sim/fight/blank.ts';
import { fighterLockedOn } from '../src/sim/fight/camera.ts';

const YOSHIMITSU = 4;

test("no fighter is held before the first field, Yoshimitsu's spinning sidestep or not", () => {
  const state = blankFightState();
  state.fighters[0].character = YOSHIMITSU;
  state.fighters[1].character = YOSHIMITSU;
  assert.equal(state.fighters[0].move, null);
  assert.equal(fighterLockedOn(state, {}), -1);
});
