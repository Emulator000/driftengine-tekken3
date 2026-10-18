/** The mode menu's corner: the game's version, and whether the repository has tagged a newer one, asked of GitHub at most every few hours. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isNewer, KEEP_HOURS, menuCorner, newestTag, newestVersion } from '../src/app/version.ts';

test('the newest tag is the highest vX.Y.Z, its numbers compared as numbers', () => {
  assert.equal(newestTag(['v0.6.5', 'v0.6.10', 'v0.6.9', 'v0.2.0']), '0.6.10');
  assert.equal(newestTag(['v1.0.0', 'v0.9.9']), '1.0.0');
});

test('tags that are not a release version are passed over', () => {
  assert.equal(newestTag(['v0.7.0-rc1', 'nightly', '0.8.0', 'v0.6.6']), '0.6.6');
  assert.equal(newestTag(['nightly']), null);
  assert.equal(newestTag([]), null);
});

test('a version is newer only when strictly higher', () => {
  assert.equal(isNewer('0.6.7', '0.6.6'), true);
  assert.equal(isNewer('0.6.10', '0.6.9'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  assert.equal(isNewer('0.6.6', '0.6.6'), false);
  assert.equal(isNewer('0.6.5', '0.6.6'), false, 'a checkout ahead of the newest tag is told nothing');
});

test("the corner shows the game's version, and a notice where a newer one is tagged", () => {
  assert.deepEqual(menuCorner('0.6.6', null), { version: '0.6.6', notice: '' });
  assert.deepEqual(menuCorner('0.6.6', '0.6.6'), { version: '0.6.6', notice: '' });
  assert.deepEqual(menuCorner('0.6.6', '0.6.7'), { version: '0.6.6', notice: '(NEW VERSION AVAILABLE!)' });
});

const HOUR = 3600 * 1000;

/** A device's storage, a clock and GitHub as the check meets them: the tags GitHub answers with (or an error), and what was asked of it. */
function world({ kept = null, tags = [], fails = false, now = 100 * HOUR } = {}) {
  const store = new Map(kept === null ? [] : [['tekken3.newest', JSON.stringify(kept)]]);
  const asked = [];
  return {
    asked,
    store,
    io: {
      now: () => now,
      storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      fetch: async (url) => {
        asked.push(url);
        if (fails) throw new Error('offline');
        return { ok: true, json: async () => tags.map((name) => ({ name })) };
      },
    },
  };
}

test('a newest version kept less than the hours ago is used without asking GitHub', async () => {
  const w = world({ kept: { newest: '0.6.7', at: 100 * HOUR - (KEEP_HOURS - 1) * HOUR } });
  assert.equal(await newestVersion(w.io), '0.6.7');
  assert.equal(w.asked.length, 0);
});

test('with none kept, or kept too long, GitHub is asked for the tags and the newest is kept', async () => {
  for (const kept of [null, { newest: '0.6.5', at: 100 * HOUR - (KEEP_HOURS + 1) * HOUR }]) {
    const w = world({ kept, tags: ['v0.6.5', 'v0.6.7', 'v0.6.6'] });
    assert.equal(await newestVersion(w.io), '0.6.7');
    assert.equal(w.asked.length, 1);
    assert.match(w.asked[0], /^https:\/\/api\.github\.com\/repos\/Emulator000\/driftengine-tekken3\/tags/);
    assert.deepEqual(JSON.parse(w.store.get('tekken3.newest')), { newest: '0.6.7', at: 100 * HOUR });
  }
});

test('where GitHub does not answer, the version kept is used however old, and none is null', async () => {
  assert.equal(await newestVersion(world({ kept: { newest: '0.6.7', at: 0 }, fails: true }).io), '0.6.7');
  assert.equal(await newestVersion(world({ fails: true }).io), null);
});

test('a storage the page may not use, or that holds something else, is passed over', async () => {
  const w = world({ tags: ['v0.6.8'] });
  w.io.storage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(await newestVersion(w.io), '0.6.8');
  const odd = world({ tags: ['v0.6.8'] });
  odd.store.set('tekken3.newest', 'not json');
  assert.equal(await newestVersion(odd.io), '0.6.8');
});
