import assert from 'node:assert/strict';
import test from 'node:test';

import { hingesOf, keepClothOff, newLimb, placeLimb, profileOf } from '../src/present/3d/fighter/garment.ts';
import { hungFromHips } from '../src/sim/fight/match.ts';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const frame = (t, r = I) => ({ r, t });
/** A turn about z: x toward y by `degrees`. */
const aboutZ = (degrees) => {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
};
const apply = (r, v) => [0, 1, 2].map((i) => r[i * 3] * v[0] + r[i * 3 + 1] * v[1] + r[i * 3 + 2] * v[2]);

/** A round leg's part, 100 mm from its line all along: points on `joint`, as a mesh lays four a vertex. */
function roundPart(joint) {
  const joints = [];
  const weights = [];
  const points = [];
  for (let s = 0; s <= 400; s += 20) {
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * 2 * Math.PI;
      joints.push(joint, 0, 0, 0);
      weights.push(1, 0, 0, 0);
      points.push(s, 100 * Math.cos(a), 100 * Math.sin(a), 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }
  return profileOf(joint, joints, weights, points);
}

/** One leg, its thigh's joint at (150, 0, 100) under the hips, turned by `turn`: its thigh and its shin, 400 mm each. */
function leg(turn) {
  const top = [150, 0, 100];
  const knee = apply(turn, [400, 0, 0]).map((v, i) => v + top[i]);
  const ankle = apply(turn, [800, 0, 0]).map((v, i) => v + top[i]);
  const thigh = newLimb(roundPart(12));
  const shin = newLimb(roundPart(13));
  placeLimb(frame([0, 0, 0]), frame(top, turn), frame(top, turn), frame(knee, turn), thigh);
  placeLimb(frame([0, 0, 0]), frame(top, turn), frame(knee, turn), frame(ankle, turn), shin);
  return [thigh, shin];
}

/** How far `p` lies from the line through `at` along the unit `along`. */
const fromLine = (p, at, along) => {
  const w = p.map((v, i) => v - at[i]);
  const s = w[0] * along[0] + w[1] * along[1] + w[2] * along[2];
  return Math.hypot(...w.map((v, i) => v - s * along[i]));
};

function keep(points, hinges, edges, lengths, limbs) {
  const out = new Float32Array(points.length);
  keepClothOff(Float32Array.from(points), new Uint8Array(points.length / 3).fill(1), Float32Array.from(hinges), Uint32Array.from(edges), Float32Array.from(lengths), limbs, new Float32Array(points.length / 3), out);
  return [...out];
}

test('a leg\'s part has its surface where its points lie, all round and all along', () => {
  const surface = roundPart(12);
  assert.ok(surface.every((r) => Math.abs(r - 100) < 1e-3));
});

test('a leg\'s part swings from rest down the hips\' x, about the axis square to both', () => {
  const [thigh] = leg(aboutZ(-50));
  assert.ok(Math.abs((thigh.swing * 180) / Math.PI - 50) < 1e-6);
  assert.deepEqual(thigh.about.map((v) => Math.round(v * 1000) / 1000 + 0), [0, 0, -1]);
  assert.equal(leg(I)[0].swing, 0);
});

test('cloth is left where it hangs while the legs are at rest, and above the legs whatever they do', () => {
  const panel = [250, -110, 100];
  const hinge = [100, -110, 100];
  assert.deepEqual(keep(panel, hinge, [], [], leg(I)).map(Math.round), panel);
  const above = [120, -60, 100];
  assert.deepEqual(keep(above, hinge, [], [], leg(aboutZ(-60))).map(Math.round), above);
});

test('a thigh swung into the cloth turns it the way it swung, as far from the thigh as it hung', () => {
  const panel = [250, -110, 100];
  const [thigh, shin] = leg(aboutZ(-50));
  const kept = keep(panel, [100, -110, 100], [], [], [thigh, shin]);
  assert.ok(fromLine(panel, thigh.at, thigh.along) < 100, 'the swung thigh reaches the cloth where it hung');
  assert.ok(fromLine(kept, thigh.at, thigh.along) >= 108 - 0.5, 'kept clear of the thigh\'s surface');
  assert.ok(kept[1] < panel[1], 'turned forward, the way the thigh swung');
});

test('a point turned carries its neighbour with it, a little less', () => {
  /* One point in the thigh's way, one far off to its side the thigh never reaches, joined as if 20 mm apart. */
  const points = [250, -110, 100, 250, -110, 400];
  const hinges = [100, -110, 100, 100, -110, 400];
  const [thigh, shin] = leg(aboutZ(-50));
  const alone = keep(points, hinges, [], [], [thigh, shin]);
  assert.deepEqual(alone.slice(3).map(Math.round), points.slice(3), 'unjoined, the far point stays');
  const joined = keep(points, hinges, [0, 1], [20], [thigh, shin]);
  assert.ok(joined[4] < points[4], 'joined, it turns too');
  assert.ok(joined[4] > joined[1], 'but less than the point the thigh reached');
});

test('a garment\'s point hangs from the nearest of its points above the thighs', () => {
  const points = [100, -100, 0, 100, -100, 200, 250, -110, 30, 260, -110, 0];
  const out = new Float32Array(points.length);
  hingesOf(points, [1, 1, 1, 0], 150, out);
  assert.deepEqual([...out.slice(6, 9)], [100, -100, 0]);
  assert.deepEqual([...out.slice(0, 3)], [100, -100, 0], 'a point above the thighs hangs from itself');
  assert.deepEqual([...out.slice(9, 12)], [0, 0, 0], 'a point not the garment\'s is left');
});

test('a panel square in a thigh\'s way is carried as far as the thigh swings, about where it hangs; not as it swings away', () => {
  const panel = [250, -105, 100];
  const hinge = [100, -105, 100];
  const angleOf = (p) => (Math.atan2(-(p[1] - hinge[1]), p[0] - hinge[0]) * 180) / Math.PI;
  const forward = keep(panel, hinge, [], [], leg(aboutZ(-20)));
  assert.ok(Math.abs(angleOf(forward) - 20) < 0.5, `turned ${angleOf(forward).toFixed(1)}°`);
  assert.ok(Math.abs(Math.hypot(forward[0] - hinge[0], forward[1] - hinge[1]) - 150) < 1e-3, 'about its hinge');
  assert.deepEqual(keep(panel, hinge, [], [], leg(aboutZ(20))).map(Math.round), panel);
});

test('a tail\'s point is not turned: where a leg swings into where its spring holds it, it is put out to the leg\'s surface, square to its line', () => {
  const tail = [250, -150, 100];
  const [thigh, shin] = leg(aboutZ(-30));
  assert.ok(fromLine(tail, thigh.at, thigh.along) < 100, 'the swung thigh reaches it');
  const out = new Float32Array(3);
  keepClothOff(Float32Array.from(tail), Uint8Array.from([0]), Float32Array.from([100, -150, 100]), new Uint32Array(0), new Float32Array(0), [thigh, shin], new Float32Array(1), out);
  const at = [...out];
  assert.ok(Math.abs(fromLine(at, thigh.at, thigh.along) - 108) < 0.5, `kept at ${fromLine(at, thigh.at, thigh.along).toFixed(1)} mm`);
  const along = (p) => p.map((v, i) => v - thigh.at[i]).reduce((s, v, i) => s + v * thigh.along[i], 0);
  assert.ok(Math.abs(along(at) - along(tail)) < 1e-3, 'level with where it was');
});

test("the tails kept clear of the legs: a board's model's own accessories hung from the hips, or the parts a console's model's records hang on the hips' part, where drawn", () => {
  const partJoints = [0, 1, 11, 12, 13, 14, 15, 16, 17, 3, 4, 5, 6, 7, 8, 9, 10, 2, 18, 19, 20, 21];
  const partRecords = [0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24];
  const records = Array.from({ length: 25 }, () => ({ offset: [0, 0, 0], parent: 0, rest: [0, 0, 0] }));
  /* Part 18 on the hips' part (2), 19 on another, 20 on the hips but not drawn, 21 hung on nothing. */
  records[21].parent = 2;
  records[22].parent = 1;
  records[23].parent = 2;
  records[24].parent = -1;
  const own = [{ parent: 11 }, null, { parent: 5 }, { parent: 11 }];
  const data = { skeleton: { partJoints, partRecords, accessoriesDrawn: [[1, 1, 0, 1], [1, 1, 1, 1]] }, models: [{ records }, { records, accessories: own }] };
  assert.deepEqual(hungFromHips(data, 0), [18], "the console's model: the drawn parts its records hang on the hips");
  assert.deepEqual(hungFromHips(data, 1), [18, 21], "the board's model: its own accessories whose parent is the hips");
  assert.deepEqual(hungFromHips({ ...data, models: [null] }, 0), [], 'no model, no tails');
});
