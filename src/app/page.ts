/**
 * The player page's parts every way of playing shares: the canvas filling the window, the asset
 * and data fetches, the renderer, the pads (and on a touch screen the touch pad), and the fixed
 * 60 Hz loop that stops on a failure and says why.
 */
import { createRenderer, ResolutionGovernor, startLoop, type RendererApi } from '@driftengine/core';
import { fightQuality } from '../present/3d/quality.ts';
import { FrameStats } from './frame-stats.ts';
import { PadInput } from './input.ts';
import { evenFrames } from './pacing.ts';
import { tellWith } from './remote-log.ts';
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

/**
 * The renderer on the canvas, the picture filling the window (the game's 4:3 widens to it), at the
 * address's `quality`, or `low` on a phone and `high` elsewhere.
 */
export async function pageRenderer(): Promise<{ renderer: RendererApi; backend: string }> {
  const frame = document.createElement('div');
  frame.style.cssText = 'position:fixed;inset:0';
  canvas.replaceWith(frame);
  frame.append(canvas);
  const { renderer, backend, reason } = await createRenderer(canvas, fightQuality(params.get('quality') ?? (onPhone() ? 'low' : 'high')));
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
}

/** The frame time the picture's density is held to, milliseconds: a 60 Hz frame and a fifth. */
const BUDGET_MS = 20;
/** The least share of its density the picture is drawn at. */
const LEAST_SCALE = 0.5;

/**
 * The game played at 60 fields a second from the pads, drawn each frame, until `stop` fields (the
 * address's, for comparing pictures) or a failure; `__tekken3()` tells what the page plays.
 *
 * The picture's density is held to the frame budget by the engine's governor: while most of a
 * fight's frames come longer than `BUDGET_MS` after the one before (`?budget` sets it, `0` holds
 * the density still) it steps down toward half its pixels each way, and back up as the frames
 * allow. Only frames drawn count: on a display faster than 60 Hz the frames between fields draw
 * nothing and take no time of their own.
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
export function play(player: Player, renderer: RendererApi, backend: string): void {
  const input = new PadInput(window);
  const touch = wantsTouch(params) ? new TouchPad() : null;
  const budget = Number(params.get('budget') ?? BUDGET_MS);
  const governor = budget > 0 ? new ResolutionGovernor(1, { budgetMs: budget, minScale: LEAST_SCALE }) : null;
  const stats = new FrameStats(() => `${backend}, ${canvas.width}x${canvas.height} at ${(governor?.scale ?? 1).toFixed(3)}`);
  tellWith(() => stats.line());
  /** When the last frame was drawn. */
  let lastDrawn = 0;
  const stopAt = Number(params.get('stop') ?? Infinity);
  let failure: Error | null = null;
  let fields = 0;
  /** The fields and the window size the last frame drawn showed, and the frames drawn and left. */
  let drawnAt = { fields: -1, width: 0, height: 0 };
  const frames = { drawn: 0, kept: 0 };
  status.textContent = '';
  startLoop(
    {
      simulate() {
        if (failure !== null || stopAt <= fields) return;
        try {
          const start = performance.now();
          if (player.field([input.word(0) | (touch?.word() ?? 0), input.word(1)]) !== false) {
            fields += 1;
            stats.field(start);
          }
        } catch (e) {
          failure = e as Error;
          console.error(e);
          status.textContent = `stopped: ${failure.message}`;
        }
      },
      render() {
        const { width, height } = canvas;
        if (fields === drawnAt.fields && width === drawnAt.width && height === drawnAt.height && player.moving?.() !== true) {
          frames.kept += 1;
          return;
        }
        const now = performance.now();
        if (lastDrawn > 0) {
          const scale = governor?.sample(now - lastDrawn, document.visibilityState === 'visible' && player.fighting()) ?? null;
          if (scale !== null) renderer.applyResolutionScale(scale);
        }
        lastDrawn = now;
        drawnAt = { fields, width, height };
        frames.drawn += 1;
        stats.drawing();
        player.render(width, height);
        stats.drawn();
      },
    },
    { fixedDt: 1 / 60, maxFrameTime: MOST_FIELDS / 60, frameSource: evenFrames() },
  );
  Object.assign(globalThis, {
    __tekken3: () => ({ remake: true, backend, fields, frames: { ...frames }, density: governor?.scale ?? 1, ...player.probe(), failure: failure?.message ?? null }),
  });
}
