/**
 * The player page's parts every way of playing shares: the canvas filling the window, the asset
 * and data fetches, the renderer, the pads (and on a touch screen the touch pad), and the fixed
 * 60 Hz loop that stops on a failure and says why.
 */
import { createRenderer, describeGpu, ResolutionGovernor, startLoop, type RendererApi } from '@driftengine/core';
import { entryLevelGpu, fightQuality, isQuality, type Quality } from '../present/3d/quality.ts';
import { crashDetails, showCrash } from './crash.ts';
import { FpsMeter } from './fps-meter.ts';
import { FrameStats } from './frame-stats.ts';
import { FreeCamera } from './free-camera.ts';
import { freeView } from '../present/3d/free-view.ts';
import { PadInput } from './input.ts';
import { CONSOLE_PADS, type Controllers } from '../present/2d/controls.ts';
import { evenFrames } from './pacing.ts';
import { tellWith } from './remote-log.ts';
import { asked, settings } from './settings.ts';
import { onPhone, TouchPad, wantsTouch } from './touch.ts';

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
const DATA = `${import.meta.env.BASE_URL}data/`;

export const params = new URLSearchParams(location.search);
const found = document.querySelector<HTMLCanvasElement>('#stage');
const label = document.querySelector<HTMLElement>('#status');
if (found === null || label === null) throw new Error('the page is missing #stage or #status');
export const canvas = found;
export const status = label;

async function fetchBytes(base: string, path: string): Promise<ArrayBuffer> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}. Have \`npm run disc\`, \`npm run extract\` and \`npm run import\` run?`);
  return response.arrayBuffer();
}
/** An asset (`public/assets/`) as JSON. */
export const json = async (path: string): Promise<unknown> => JSON.parse(new TextDecoder().decode(await fetchBytes(ASSETS, path)));
/** An asset's bytes (`public/assets/`). */
export const assetBytes = (path: string): Promise<ArrayBuffer> => fetchBytes(ASSETS, path);
/** An asset's picture (`public/assets/`). */
export const assetImage = async (path: string): Promise<ImageBitmap> =>
  createImageBitmap(new Blob([await fetchBytes(ASSETS, path)], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
/** A file of the drawing data (`public/data/`), and a picture of it. */
export const dataBytes = (path: string): Promise<ArrayBuffer> => fetchBytes(DATA, path);
/** Where a data file (`public/data/`) is served, for what streams it itself (a movie's video). */
export const dataUrl = (path: string): string => `${DATA}${path}`;
export const image = async (path: string): Promise<ImageBitmap> =>
  createImageBitmap(new Blob([await fetchBytes(DATA, path)], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
export const two = (n: number): string => String(n).padStart(2, '0');

/** Where the browser keeps that this device's fights were too slow even at their least density. */
const SLOW = 'tekken3.slow';
/** The page's quality, as `pageRenderer` picked it. */
let quality: Quality = 'high';

/** The page's quality, once `pageRenderer` has picked it. */
export const pageQuality = (): Quality => quality;

/**
 * The picture's quality: the address's (`?quality=high`, `low` or `verylow`), or REMAKE OPTION's; else `verylow` where a
 * start before found a fight's frames too slow even at their least density, or on a phone whose GPU
 * the browser names as an entry-level part; else `low` on a phone and `high` elsewhere.
 */
async function pickQuality(): Promise<{ quality: Quality; why: string }> {
  const chosen = asked(params, 'quality', settings.picture, [null, 'high', 'low', 'verylow']);
  if (isQuality(chosen)) return { quality: chosen, why: params.has('quality') ? 'asked' : 'set in REMAKE OPTION' };
  if (stored(SLOW)) return { quality: 'verylow', why: 'a fight before ran too slow at its least density' };
  if (!onPhone()) return { quality: 'high', why: 'not a phone' };
  const { rendererName } = await describeGpu();
  if (entryLevelGpu(rendererName)) return { quality: 'verylow', why: `a phone with an entry-level GPU, ${rendererName}` };
  return { quality: 'low', why: `a phone, ${rendererName || 'its GPU unnamed'}` };
}

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * The renderer on the canvas, the picture filling the window (the game's 4:3 widens to it), at the
 * quality `pickQuality` gives.
 */
export async function pageRenderer(): Promise<{ renderer: RendererApi; backend: string }> {
  const frame = document.createElement('div');
  frame.style.cssText = 'position:fixed;inset:0';
  canvas.replaceWith(frame);
  frame.append(canvas);
  const picked = await pickQuality();
  quality = picked.quality;
  console.log(`[tekken3 remake] quality ${quality}: ${picked.why}`);
  const { renderer, backend, reason } = await createRenderer(canvas, fightQuality(quality));
  console.log(`[tekken3 remake] ${backend}: ${reason}`);
  renderer.resize();
  addEventListener('resize', () => renderer.resize());
  return { renderer, backend };
}

/** What a way of playing does each field and each frame. */
export interface Player {
  /** One field from the pads; false when the game waits (for a match's data) and the field did not happen. */
  field(pads: readonly [number, number]): boolean | void;
  render(width: number, height: number): void;
  /** Whether the picture moves between fields (a dissolve, a movie's frames), so every frame is drawn; absent, only a frame with a new field is. */
  moving?(): boolean;
  /** Whether a fight is on screen: its frames alone move the picture's density. */
  fighting(): boolean;
  /** What the page's probe tells about the game. */
  probe(): Record<string, unknown>;
  /** What was playing, by name, for the game's stop (`crash.ts`). */
  about?(): Record<string, unknown>;
}

/** The frame time the picture's density is held to, milliseconds: a 60 Hz frame and a fifth. */
const BUDGET_MS = 20;
/** The least share of its density the picture is drawn at. */
const LEAST_SCALE = 0.5;
/** The fewest milliseconds between pictures on a very low page: thirty a second, the game still running sixty fields. */
const VERY_LOW_FRAME_MS = 1000 / 30 - 4;
/** Fight frames at the least density judged together, and the share of them that, over budget, makes this device a slow one. */
const SLOW_FRAMES = 300;
const SLOW_SHARE = 0.5;

/**
 * The game played at 60 fields a second from the pads, drawn each frame, until `stop` fields (the
 * address's, for comparing pictures) or a failure; `__tekken3()` tells what the page plays.
 *
 * The picture's density is held to the frame budget by the engine's governor: while most of a
 * fight's frames come longer than `BUDGET_MS` after the one before (`?budget` sets it, `0` holds
 * the density still) it steps down toward half its pixels each way, and back up as the frames
 * allow. Only frames drawn count: on a display faster than 60 Hz the frames between fields draw
 * nothing and take no time of their own. Where most of a fight's frames still run over budget at the
 * least density, the browser keeps it, and the next start draws the very low picture.
 *
 * A very low page draws thirty pictures a second at most (`VERY_LOW_FRAME_MS`), its budget doubled;
 * the fields still run sixty a second.
 *
 * `FrameStats` measures the fields and the drawing, for a page on another device to tell.
 *
 * The display's frames are counted evenly (`pacing.ts`), so a 60 Hz or 120 Hz display runs the
 * fields one a frame or one every other frame, never bunched.
 *
 * A frame runs two fields at most: after a slow frame the game runs late, as the console's slows,
 * rather than catching up with up to fifteen fields in one frame (the engine's quarter second),
 * which played a screen's slide, fades or whole short scenes (the versus screen's) unseen.
 *
 * A frame draws only when a field ran since the last it drew, the picture moves between fields
 * (`moving`) or the window changed size: on a display faster than 60 Hz the frames between fields
 * drew the same picture again (every other frame at 120 Hz, the whole 3D frame and the 2D over it).
 */
const MOST_FIELDS = 2;
/** The pads read while the game plays. */
let pads: PadInput | null = null;

/** Each player's controller as it last played (a PlayStation pad's until the game plays). */
export function controllers(): Controllers {
  return pads?.controllers() ?? CONSOLE_PADS;
}

export function play(player: Player, renderer: RendererApi, backend: string): void {
  const input = new PadInput(window);
  pads = input;
  const touch = wantsTouch(params) ? new TouchPad() : null;
  if (touch !== null) input.uses(0, 'touch');
  const veryLow = quality === 'verylow';
  const budget = Number(params.get('budget') ?? (veryLow ? 2 * BUDGET_MS : BUDGET_MS));
  const governor = budget > 0 ? new ResolutionGovernor(1, { budgetMs: budget, minScale: LEAST_SCALE }) : null;
  /** Fight frames drawn at the least density, and those of them over budget, toward judging this device slow. */
  const slow = { frames: 0, long: 0, kept: veryLow };
  const stats = new FrameStats(() => `${backend}, ${canvas.width}x${canvas.height} at ${(governor?.scale ?? 1).toFixed(3)}`);
  tellWith(() => stats.line());
  /** When the last frame was drawn. */
  let lastDrawn = 0;
  /** One fight frame at the least density; after `SLOW_FRAMES`, this device kept as a slow one where most ran over budget. */
  const judgeSlow = (long: boolean): void => {
    slow.frames += 1;
    if (long) slow.long += 1;
    if (slow.frames < SLOW_FRAMES) return;
    if (slow.long / slow.frames >= SLOW_SHARE) {
      slow.kept = true;
      try {
        localStorage.setItem(SLOW, '1');
      } catch {
        /* Not kept where the page may not store: the next start judges again. */
      }
      console.log(`[tekken3 remake] ${slow.long} of ${slow.frames} fight frames over ${budget} ms at the least density: the next start draws the very low picture`);
    }
    slow.frames = 0;
    slow.long = 0;
  };
  const stopAt = Number(params.get('stop') ?? Infinity);
  /* `P` flies a free camera through the held fight; `F` shows the frame rate. */
  new FreeCamera(canvas);
  const meter = new FpsMeter();
  let failure: Error | null = null;
  /** A frame failed to draw: the picture is held as it was. */
  let undrawable = false;
  let fields = 0;
  /** The fields and the window size the last frame drawn showed, and the frames drawn and left. */
  let drawnAt = { fields: -1, width: 0, height: 0 };
  const frames = { drawn: 0, kept: 0 };
  status.textContent = '';
  startLoop(
    {
      simulate() {
        if (failure !== null || stopAt <= fields || freeView.active) return;
        try {
          const start = performance.now();
          const touched = touch?.word() ?? 0;
          if (touched !== 0) input.uses(0, 'touch');
          if (player.field([input.word(0) | touched, input.word(1)]) !== false) {
            fields += 1;
            stats.field(start);
          }
        } catch (e) {
          failure = e as Error;
          showCrash(e, 'stepping the game');
        }
      },
      render() {
        if (undrawable) return;
        const { width, height } = canvas;
        const now = performance.now();
        const same = fields === drawnAt.fields && width === drawnAt.width && height === drawnAt.height && player.moving?.() !== true && !freeView.active;
        if (same || (veryLow && now - lastDrawn < VERY_LOW_FRAME_MS)) {
          frames.kept += 1;
          if (same) meter.frame(now);
          return;
        }
        if (lastDrawn > 0) {
          const counted = document.visibilityState === 'visible' && player.fighting();
          const scale = governor?.sample(now - lastDrawn, counted) ?? null;
          if (scale !== null) renderer.applyResolutionScale(scale);
          if (counted && !slow.kept && governor !== null && governor.scale <= LEAST_SCALE) judgeSlow(now - lastDrawn > budget);
        }
        lastDrawn = now;
        drawnAt = { fields, width, height };
        frames.drawn += 1;
        stats.drawing();
        try {
          player.render(width, height);
        } catch (e) {
          failure = e as Error;
          undrawable = true;
          showCrash(e, 'drawing the game');
          return;
        }
        stats.drawn();
        meter.frame(now);
      },
    },
    { fixedDt: 1 / 60, maxFrameTime: MOST_FIELDS / 60, frameSource: evenFrames() },
  );
  crashDetails(() => ({ ...(player.about?.() ?? player.probe()), Field: fields, Renderer: backend, Quality: quality }));
  Object.assign(globalThis, {
    __tekken3: () => ({ remake: true, backend, quality, fields, frames: { ...frames }, density: governor?.scale ?? 1, timing: stats.line(), ...player.probe(), failure: failure?.message ?? null }),
  });
}
