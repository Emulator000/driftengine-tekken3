/**
 * The assets the importer writes load and validate, and a malformed or stale file is refused with
 * its name and field.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ASSET_FORMAT, parseManifest } from '../src/assets/manifest.ts';
import { parseMathTables } from '../src/assets/math.ts';
import { AssetError } from '../src/assets/validate.ts';

const imported = existsSync('public/assets/manifest.json');
const json = (name) => JSON.parse(readFileSync(`public/assets/${name}`, 'utf8'));

test('the manifest is the current format', { skip: !imported }, () => {
  assert.equal(parseManifest(json('manifest.json')).format, ASSET_FORMAT);
});

test('the math tables load: the sine a turn and a quarter long, the arctangent, both root tables', { skip: !imported }, () => {
  const tables = parseMathTables(json('tables/math.json'));
  assert.equal(tables.sine.length, 5120);
  assert.equal(tables.sine[0], 0);
  assert.equal(tables.sine[1024], 4096, 'a quarter turn is 1.0 in 4.12');
  assert.equal(tables.atan.length, 1025);
  assert.equal(tables.roots.length, 192);
  assert.equal(tables.negativeRoots.length, 192);
});

test('a malformed or stale file is refused, naming the file and the field', () => {
  const good = { sine: Array(5120).fill(0), atan: Array(1025).fill(0), roots: Array(192).fill(0), negativeRoots: Array(192).fill(0), libraryNegativeRoots: Array(192).fill(0) };
  const refused = (value, pattern) => assert.throws(() => parseMathTables(value), (e) => e instanceof AssetError && /tables\/math\.json/.test(e.message) && pattern.test(e.message));
  refused(null, /not an object/);
  refused({ ...good, sine: [0] }, /sine has 1 entries, not 5120/);
  refused({ ...good, atan: [...good.atan.slice(1), 256] }, /atan\[1024\] is 256/);
  assert.throws(() => parseManifest({ format: ASSET_FORMAT - 1, movesets: [], kazuya: false }), /npm run import/);
});
