/**
 * The fighters' and the attract intros' meshes rounded (`scripts/lib/round.mjs`) for the smooth
 * models the remake draws by default: `models/fighters/NN.ftr` and `models/intro/I-PP.ftr`, from
 * `public/data/`. A mesh of another version (Kazuya's, from Tekken 4) is copied as it is.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { roundFighter } from '../lib/round.mjs';

/** Writes every mesh into `output`; returns how many were rounded. */
export function roundModels(root, output) {
  let rounded = 0;
  for (const kind of ['fighters', 'intro']) {
    const dir = path.join(root, 'public/data', kind);
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ftr')).sort()) {
      const bytes = new Uint8Array(readFileSync(path.join(dir, name)));
      const target = `models/${kind}/${name}`;
      if (![1, 5].includes(new DataView(bytes.buffer).getUint32(4, true))) {
        output.bytes(target, bytes);
        continue;
      }
      const { skeleton } = JSON.parse(readFileSync(path.join(dir, name.replace(/\.ftr$/, '.json')), 'utf8'));
      try {
        output.bytes(target, roundFighter(bytes, skeleton));
      } catch (error) {
        throw new Error(`${kind}/${name}: ${error.message}`);
      }
      rounded += 1;
    }
  }
  return rounded;
}
