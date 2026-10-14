/**
 * The remake's own settings (REMAKE OPTION in the Options), kept on this device in the engine's
 * store (the browser's storage, or the app's) and read as the page starts: the textures, the
 * fighters' models, the arcade's stages and fighters, the cloth, the picture's quality, the frame
 * rate shown and the touch pad. A setting the page's address gives (`?textures=`, `?models=`,
 * `?stages=`, `?fighters=`, `?cloth=`, `?quality=`, `?touch=`)
 * wins over the kept one for that start.
 */
import { defaultStore, type KeyValueStore } from '@driftengine/core';
import { REMAKE_DEFAULTS } from '../sim/game/remake-options.ts';
import type { RemakeSettings } from '../sim/game/state.ts';

const KEY = 'tekken3.settings';
/** Where the frame rate's switch was kept before the settings were. */
const FRAME_RATE_KEY = 'tekken3.fps';
/** Each setting's values. */
const COUNTS: Readonly<RemakeSettings> = { textures: 2, models: 3, stages: 2, fighters: 2, cloth: 2, picture: 4, frameRate: 2, touchPad: 3 };

/** The settings kept in `store`, each that is missing or out of its range at its default. */
export function readSettings(store: KeyValueStore = defaultStore()): RemakeSettings {
  const settings = { ...REMAKE_DEFAULTS };
  let kept: unknown = null;
  try {
    kept = JSON.parse(store.read(KEY) ?? 'null');
  } catch {
    /* Unreadable: the defaults. */
  }
  if (kept !== null && typeof kept === 'object') {
    for (const key of Object.keys(COUNTS) as (keyof RemakeSettings)[]) {
      const value = (kept as Record<string, unknown>)[key];
      if (Number.isInteger(value) && 0 <= (value as number) && (value as number) < COUNTS[key]) settings[key] = value as number;
    }
  } else if (store.read(FRAME_RATE_KEY) === '1') settings.frameRate = 1;
  return settings;
}

/** The settings kept in `store`, in place of what was. */
export function writeSettings(settings: RemakeSettings, store: KeyValueStore = defaultStore()): void {
  store.write(KEY, JSON.stringify(settings));
}

/** The settings as the page started with them. */
export const settings: Readonly<RemakeSettings> = readSettings();

/**
 * A setting as the address's word for it, the address's own where it gives one: the kept value's
 * word (null for one left to the page to choose).
 */
export function asked(params: URLSearchParams, name: string, value: number, words: readonly (string | null)[]): string | null {
  return params.get(name) ?? words[value] ?? null;
}
