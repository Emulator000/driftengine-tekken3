/** The importer's manifest: the format it wrote, which movesets it wrote, and which stages the arcade's data has. */
import { AssetError, expectArray, expectBoolean, expectInt, expectObject } from './validate.ts';

/** The format the importer writes and the loaders read. Raised when an asset's shape changes. */
export const ASSET_FORMAT = 45;

/** How many times their size the original pictures are written (`pictures/*.png`), enlarged by edge-directed interpolation. */
export const PICTURE_SCALE = 4;

/** How many times their size the fighters' and stages' texture atlases are written for the smooth textures (`textures/*`). */
export const TEXTURE_SCALE = { fighters: 4, stages: 2 } as const;

export interface Manifest {
  readonly format: number;
  readonly movesets: readonly number[];
  readonly kazuya: boolean;
  /** The stages drawn from the arcade board's data, when `npm run arcade` read it. */
  readonly arcadeStages: readonly number[];
  /** Those of them with a panorama behind their scenery. */
  readonly arcadePanoramas: readonly ArcadePanorama[];
  /** Their moving pieces. */
  readonly arcadeObjects: readonly ArcadeObject[];
}

/** A sway: one of the piece's height or angles moved `step` a field, the other way every `period` fields, the first time after `start`. */
export interface Sway {
  readonly channel: 'height' | 'pitch' | 'yaw' | 'roll';
  readonly step: number;
  readonly period: number;
  readonly start: number;
}

export interface PiecePart {
  readonly at: readonly [number, number, number];
  readonly angles: readonly [number, number, number];
  readonly spin: { readonly axis: number; readonly rate: number };
}

export interface PieceMotion {
  readonly at: readonly [number, number, number];
  readonly angles: readonly [number, number, number];
  /** The yaw's turn a field (4096ths), and the fields after which it starts again from its angle (0 never). */
  readonly spin: number;
  readonly wrap: number;
  readonly sway: readonly Sway[];
  readonly parts: readonly PiecePart[];
}

/**
 * A stage's moving piece: its number among the stage's, how it stands and moves, its
 * frames (its mesh's cells, drawn in turn) and the fields each shows.
 */
export interface ArcadeObject extends PieceMotion {
  readonly stage: number;
  readonly piece: number;
  readonly frames: number;
  readonly fields: number;
}

/** A panorama: the colours of its top and bottom rows (8-bit sRGB), and how far down it its horizon lies (a share of its height). */
export interface ArcadePanorama {
  readonly stage: number;
  readonly top: readonly [number, number, number];
  readonly bottom: readonly [number, number, number];
  readonly horizon: number;
}

export function parseManifest(json: unknown, where = 'manifest.json'): Manifest {
  const o = expectObject(json, where);
  const format = expectInt(o.format, `${where} format`, 0, 0xffff);
  if (format !== ASSET_FORMAT) throw new AssetError(where, `is format ${format}, not ${ASSET_FORMAT}: run npm run import`);
  return {
    format,
    movesets: expectArray(o.movesets, `${where} movesets`).map((v, i) => expectInt(v, `${where} movesets[${i}]`, 0, 0xff)),
    kazuya: expectBoolean(o.kazuya, `${where} kazuya`),
    arcadeStages: expectArray(o.arcadeStages, `${where} arcadeStages`).map((v, i) => expectInt(v, `${where} arcadeStages[${i}]`, 0, 0x13)),
    arcadePanoramas: expectArray(o.arcadePanoramas, `${where} arcadePanoramas`).map((v, i) => {
      const panorama = expectObject(v, `${where} arcadePanoramas[${i}]`);
      const colour = (key: 'top' | 'bottom'): readonly [number, number, number] => {
        const c = expectArray(panorama[key], `${where} arcadePanoramas[${i}].${key}`, 3).map((v, k) => expectInt(v, `${where} arcadePanoramas[${i}].${key}[${k}]`, 0, 0xff));
        return [c[0]!, c[1]!, c[2]!];
      };
      const horizon = panorama.horizon;
      if (typeof horizon !== 'number' || !(0 <= horizon && horizon <= 1)) throw new AssetError(`${where} arcadePanoramas[${i}].horizon`, 'is not a share of the picture');
      return { stage: expectInt(panorama.stage, `${where} arcadePanoramas[${i}].stage`, 0, 0x13), top: colour('top'), bottom: colour('bottom'), horizon };
    }),
    arcadeObjects: expectArray(o.arcadeObjects, `${where} arcadeObjects`).map((v, i) => {
      const at = `${where} arcadeObjects[${i}]`;
      const object = expectObject(v, at);
      const three = (value: unknown, name: string): [number, number, number] => {
        const n = expectArray(value, `${at}.${name}`, 3).map((c, k) => expectInt(c, `${at}.${name}[${k}]`, -0x8000, 0x7fff));
        return [n[0]!, n[1]!, n[2]!];
      };
      const number = (value: unknown, name: string): number => {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new AssetError(`${at}.${name}`, 'is not a number');
        return value;
      };
      const sway = expectArray(object.sway, `${at}.sway`).map((w, k): Sway => {
        const s = expectObject(w, `${at}.sway[${k}]`);
        if (s.channel !== 'height' && s.channel !== 'pitch' && s.channel !== 'yaw' && s.channel !== 'roll') throw new AssetError(`${at}.sway[${k}].channel`, 'is not a height or an angle');
        return { channel: s.channel, step: number(s.step, `sway[${k}].step`), period: expectInt(s.period, `${at}.sway[${k}].period`, 1, 0x10000), start: expectInt(s.start, `${at}.sway[${k}].start`, 0, 0x10000) };
      });
      const parts = expectArray(object.parts, `${at}.parts`).map((p, k) => {
        const part = expectObject(p, `${at}.parts[${k}]`);
        const spin = expectObject(part.spin, `${at}.parts[${k}].spin`);
        return { at: three(part.at, `parts[${k}].at`), angles: three(part.angles, `parts[${k}].angles`), spin: { axis: expectInt(spin.axis, `${at}.parts[${k}].spin.axis`, 0, 2), rate: number(spin.rate, `parts[${k}].spin.rate`) } };
      });
      return {
        stage: expectInt(object.stage, `${at}.stage`, 0, 0x13),
        piece: expectInt(object.piece, `${at}.piece`, 0, 0xff),
        at: three(object.at, 'at'),
        angles: three(object.angles, 'angles'),
        spin: number(object.spin, 'spin'),
        wrap: expectInt(object.wrap, `${at}.wrap`, 0, 0x10000),
        sway,
        parts,
        frames: expectInt(object.frames, `${at}.frames`, 1, 0x100),
        fields: expectInt(object.fields, `${at}.fields`, 1, 0x100),
      };
    }),
  };
}
