/**
 * The build's scripts run gently: below the machine's other work, and their worker pools on half
 * its cores at most, so a long import or extraction leaves the machine usable.
 */
import assert from 'node:assert/strict';
import { getPriority } from 'node:os';
import { test } from 'node:test';

import { runGently, workersFor } from '../scripts/lib/gentle.mjs';

test("a worker pool takes half the machine's cores at most, and one at least", () => {
  assert.equal(workersFor(16), 8);
  assert.equal(workersFor(3), 1);
  assert.equal(workersFor(1), 1);
  assert.equal(workersFor(16, 3), 3, 'no more than there is work for');
});

test("a script run gently gives way to the machine's other work", () => {
  runGently();
  assert.ok(getPriority() >= 10, `its priority ${getPriority()}`);
});
