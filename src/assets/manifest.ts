/** The importer's manifest: the format it wrote, which movesets it wrote, and which stages the arcade's data has. */
import { AssetError, expectArray, expectBoolean, expectInt, expectObject } from './validate.ts';

/** The format the importer writes and the loaders read. Raised when an asset's shape changes. */
export const ASSET_FORMAT = 52;

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
  /** The fighters' packs drawn with the board's models, where it was read. */
  readonly arcadeFighters: readonly number[];
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

/** An 8-bit sRGB colour. */
export type Rgb = readonly [number, number, number];

/**
 * An arcade stage's background, as its game draws it: its panorama of `columns` × `rows` tiles of
 * 64 texels, scrolled `degrees` of a turn across the game's 512-pixel screen; per row, a cell for
 * each tile's width round a whole turn (`perTurn` of them), its tile (`p`), the colour below (`b`),
 * the filled tile's colour (`t`) or nothing (`.`); its top `offset`
 * lines down the picture's 480, moving `pitch` 256ths of a line for each 4096th the camera
 * pitches, kept between `least` and `most` where it has them; its colours (its sky's the mean of
 * its first row's top texels), and whether the one above the panorama and the one below it are
 * drawn; stage 3's gradient in place of its tiles,
 * stage 6's colour over the whole picture, and the row stage 5 draws upside down.
 */
export interface ArcadePanorama {
  readonly stage: number;
  readonly columns: number;
  readonly rows: number;
  readonly degrees: number;
  readonly perTurn: number;
  readonly mask: readonly string[];
  readonly offset: number;
  readonly pitch: number;
  readonly most: number | null;
  readonly least: number | null;
  readonly colours: { readonly cell: Rgb; readonly above: Rgb; readonly below: Rgb; readonly sky: Rgb };
  readonly drawn: { readonly above: boolean; readonly below: boolean };
  readonly gradient: { readonly from: Rgb; readonly to: Rgb; readonly lines: number } | null;
  readonly whole: boolean;
  readonly flipped: number | null;
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
    arcadePanoramas: expectArray(o.arcadePanoramas, `${where} arcadePanoramas`).map((v, i): ArcadePanorama => {
      const at = `${where} arcadePanoramas[${i}]`;
      const panorama = expectObject(v, at);
      const rgb = (value: unknown, name: string): Rgb => {
        const c = expectArray(value, `${at}.${name}`, 3).map((v, k) => expectInt(v, `${at}.${name}[${k}]`, 0, 0xff));
        return [c[0]!, c[1]!, c[2]!];
      };
      const flag = (value: unknown, name: string): boolean => {
        if (typeof value !== 'boolean') throw new AssetError(`${at}.${name}`, 'is not true or false');
        return value;
      };
      const columns = expectInt(panorama.columns, `${at}.columns`, 1, 0x40);
      const rows = expectInt(panorama.rows, `${at}.rows`, 1, 0x40);
      const degrees = expectInt(panorama.degrees, `${at}.degrees`, 1, 360);
      const perTurn = expectInt(panorama.perTurn, `${at}.perTurn`, Math.trunc(0x2d000 / degrees) >> 6, Math.trunc(0x2d000 / degrees) >> 6);
      const mask = expectArray(panorama.mask, `${at}.mask`, rows).map((row, r) => {
        if (typeof row !== 'string' || row.length !== perTurn || !/^[pbt.]*$/.test(row)) throw new AssetError(`${at}.mask[${r}]`, `is not ${perTurn} cells of p, b, t or .`);
        return row;
      });
      const colours = expectObject(panorama.colours, `${at}.colours`);
      const drawn = expectObject(panorama.drawn, `${at}.drawn`);
      const gradient = panorama.gradient === undefined ? null : expectObject(panorama.gradient, `${at}.gradient`);
      return {
        stage: expectInt(panorama.stage, `${at}.stage`, 0, 0x13),
        columns,
        rows,
        degrees,
        perTurn,
        mask,
        offset: expectInt(panorama.offset, `${at}.offset`, -0x8000, 0x7fff),
        pitch: expectInt(panorama.pitch, `${at}.pitch`, -0x8000, 0x7fff),
        most: panorama.most === undefined ? null : expectInt(panorama.most, `${at}.most`, -0x8000, 0x7fff),
        least: panorama.least === undefined ? null : expectInt(panorama.least, `${at}.least`, -0x8000, 0x7fff),
        colours: { cell: rgb(colours.cell, 'colours.cell'), above: rgb(colours.above, 'colours.above'), below: rgb(colours.below, 'colours.below'), sky: rgb(colours.sky, 'colours.sky') },
        drawn: { above: flag(drawn.above, 'drawn.above'), below: flag(drawn.below, 'drawn.below') },
        gradient: gradient === null ? null : { from: rgb(gradient.from, 'gradient.from'), to: rgb(gradient.to, 'gradient.to'), lines: expectInt(gradient.lines, `${at}.gradient.lines`, 1, 480) },
        whole: panorama.whole === undefined ? false : flag(panorama.whole, 'whole'),
        flipped: panorama.flipped === undefined ? null : expectInt(panorama.flipped, `${at}.flipped`, 0, rows - 1),
      };
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
    arcadeFighters: expectArray(o.arcadeFighters, `${where} arcadeFighters`).map((v, i) => expectInt(v, `${where} arcadeFighters[${i}]`, 0, 0xff)),
  };
}
