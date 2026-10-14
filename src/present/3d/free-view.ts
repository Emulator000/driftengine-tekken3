/**
 * The free camera's hold on the fight's view: while it flies (`P`, src/app/free-camera.ts) the
 * view takes its camera in place of the fight's, after taking the fight's, draws every cell of the
 * scenery, the game's culling being the fight camera's, and draws the fighters a little toward it.
 */
import type { Camera } from '@driftengine/core';

export const freeView: { active: boolean; apply: (camera: Camera, aspect: number) => void; eye: [number, number, number] } = {
  active: false,
  apply: () => {},
  /** Where it stands, in the engine's axes (metres), which the fighters are drawn a little toward. */
  eye: [0, 0, 0],
};
