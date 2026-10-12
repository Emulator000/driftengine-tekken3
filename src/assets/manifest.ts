/** The importer's manifest: the format it wrote and which movesets it wrote. */
import { AssetError, expectArray, expectBoolean, expectInt, expectObject } from './validate.ts';

/** The format the importer writes and the loaders read. Raised when an asset's shape changes. */
export const ASSET_FORMAT = 33;

/** How many times their size the original pictures are written (`pictures/*.png`), enlarged by edge-directed interpolation. */
export const PICTURE_SCALE = 4;

/** How many times their size the fighters' and stages' texture atlases are written for the smooth textures (`textures/*`). */
export const TEXTURE_SCALE = { fighters: 4, stages: 2 } as const;

export interface Manifest {
  readonly format: number;
  readonly movesets: readonly number[];
  readonly kazuya: boolean;
}

export function parseManifest(json: unknown, where = 'manifest.json'): Manifest {
  const o = expectObject(json, where);
  const format = expectInt(o.format, `${where} format`, 0, 0xffff);
  if (format !== ASSET_FORMAT) throw new AssetError(where, `is format ${format}, not ${ASSET_FORMAT}: run npm run import`);
  return {
    format,
    movesets: expectArray(o.movesets, `${where} movesets`).map((v, i) => expectInt(v, `${where} movesets[${i}]`, 0, 0xff)),
    kazuya: expectBoolean(o.kazuya, `${where} kazuya`),
  };
}
