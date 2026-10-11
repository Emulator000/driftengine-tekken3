/** The importer's output: files rewritten in place, stale ones removed, directories kept. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createOutput } from '../scripts/import/output.mjs';

test('a run rewrites its files in place, removes what it did not write and keeps the directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tekken3-import-'));
  mkdirSync(path.join(root, 'tables'));
  writeFileSync(path.join(root, 'tables/math.json'), 'old');
  writeFileSync(path.join(root, 'tables/stale.json'), '{}');
  const directory = statSync(path.join(root, 'tables')).ino;
  const output = createOutput(root);
  output.json('tables/math.json', { sine: [0] });
  output.finish({ format: 1, movesets: [], kazuya: false });
  assert.equal(readFileSync(path.join(root, 'tables/math.json'), 'utf8'), '{"sine":[0]}');
  assert.equal(existsSync(path.join(root, 'tables/stale.json')), false);
  assert.equal(statSync(path.join(root, 'tables')).ino, directory);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')), { format: 1, movesets: [], kazuya: false });
});
