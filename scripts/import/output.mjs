/**
 * Where the importer writes: each file rewritten in place, so a running dev server keeps serving
 * the directory, and at the end every file under the root that this run did not write removed.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function createOutput(root) {
  const written = new Set();
  const put = (relative, data) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.add(target);
  };
  return {
    json: (relative, value) => put(relative, JSON.stringify(value)),
    bytes: (relative, data) => put(relative, data),
    /** The path a file this run left as it was (up to date) lies at, kept from the cleanup. */
    keep(relative) {
      const target = path.join(root, relative);
      written.add(target);
      return target;
    },
    finish(manifest) {
      put('manifest.json', JSON.stringify(manifest, null, 2));
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        const file = path.join(entry.parentPath, entry.name);
        if (entry.isFile() && !written.has(file)) rmSync(file);
      }
    },
  };
}
