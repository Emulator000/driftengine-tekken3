/**
 * An online fight seen from the other side of the fighters' line (as the player whose side is the
 * other one's sees it): the camera reflected across the upright plane through both fighters, a
 * camera like any other (nothing drawn mirrored), each fighter where the other stood in the picture;
 * the game's camera, for the scenery's layout, reflected alike.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { otherSideCamera, otherSideView } from '../src/present/3d/other-side.ts';

/** A view (world to camera, column-major) looking from `eye` at `at`, y up: the engine's axes, metres. */
function lookAt(eye, at) {
  const f = at.map((v, i) => v - eye[i]);
  const fl = Math.hypot(...f);
  const fw = f.map((v) => v / fl);
  const r = [-fw[2], 0, fw[0]].map((v) => v / Math.hypot(fw[2], fw[0]));
  const u = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([r[0], u[0], -fw[0], 0, r[1], u[1], -fw[1], 0, r[2], u[2], -fw[2], 0, -dot(r, eye), -dot(u, eye), dot(fw, eye), 1]);
}
const apply = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
/** A game point (millimetres, y down, z away) in the engine's axes. */
const engine = (p) => [p[0] / 1000, -p[1] / 1000, -p[2] / 1000];
const near = (a, b, within, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < within, `${what}: ${a} against ${b}`));

test('seen from the other side, each fighter stands where the other stood in the picture, at the same depth, the view a camera like any other', () => {
  const [a, b] = [[-800, 0, 300], [700, 0, -200]];
  const mid = engine([(a[0] + b[0]) / 2, -1000, (a[2] + b[2]) / 2]);
  const view = lookAt([mid[0] + 1.2, 1.6, mid[2] + 3.4], mid);
  const turned = Float32Array.from(view);
  otherSideView(turned, a, b);
  const [pa, pb] = [apply(view, engine(a)), apply(view, engine(b))];
  const [qa, qb] = [apply(turned, engine(a)), apply(turned, engine(b))];
  assert.ok(pa[0] < 0 && pb[0] > 0, 'the first on the left as the game sees it');
  near(qa, [-pa[0], pa[1], pa[2]], 1e-5, 'the first where it stood mirrored');
  near(qb, [-pb[0], pb[1], pb[2]], 1e-5, 'the second too');
  const r = turned;
  const det = r[0] * (r[5] * r[10] - r[9] * r[6]) - r[4] * (r[1] * r[10] - r[9] * r[2]) + r[8] * (r[1] * r[6] - r[5] * r[2]);
  assert.ok(Math.abs(det - 1) < 1e-5, `a turn, not a mirror (${det})`);
  /* A camera square to the fighters' line: what stood behind them is now behind it, the stage seen from its other side. */
  const [c, d] = [[-1000, 0, 0], [1000, 0, 0]];
  const square = lookAt([0.2, 1.6, 3], [0, 1, 0]);
  const across = Float32Array.from(square);
  otherSideView(across, c, d);
  const behind = engine([0, -1000, 6000]);
  assert.ok(apply(square, behind)[2] < -5, 'behind the fighters as the game sees them');
  assert.ok(apply(across, behind)[2] > 0, 'behind the camera seen from the other side');
});

test("the game's camera seen from the other side: its eye across the fighters' line at its height and distance, looking the same way across it", () => {
  const [a, b] = [[-1000, 0, 0], [1000, 0, 0]];
  const camera = { eye: [300, -1200, 3000], yaw: 0x800, pitch: 0x20 };
  const turned = otherSideCamera(camera, a, b);
  near(turned.eye, [300, -1200, -3000], 1, 'across the line');
  assert.equal(turned.pitch, 0x20, 'its pitch kept');
  assert.equal(turned.yaw, 0, 'looking back across it');
});

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';

test("on a fight from the imported data, the game's camera and its view seen from the other side agree: the view's eye the camera's, the camera looking at the fighters", { skip }, async () => {
  const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { loadFightTables, loadMoveset } = await import('../src/assets/load.ts');
  const { fightDataFor, matchMovesets } = await import('../src/sim/fight/match.ts');
  const { Fight } = await import('../src/sim/fight/fight.ts');
  const { tables } = await loadFightTables(json);
  const setup = { stage: 2, entrants: [{ roster: 0, costume: 0, computer: false }, { roster: 9, costume: 0, computer: false }] };
  const [first, second] = matchMovesets(tables, setup);
  const two = (n) => String(n).padStart(2, '0');
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const fight = Fight.quick(fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common')), setup);
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  const state = fight.state;
  const [ra, rb] = state.fighters.map((f) => [...f.skeleton.base.translation]);
  const camera = state.camera.drawn;
  /* The game's yaw looks along (-sin, cos) across x and z. */
  const look = [-Math.sin((camera.yaw * 2 * Math.PI) / 4096), Math.cos((camera.yaw * 2 * Math.PI) / 4096)];
  const mid = [(ra[0] + rb[0]) / 2 - camera.eye[0], (ra[2] + rb[2]) / 2 - camera.eye[2]];
  assert.ok(look[0] * mid[0] + look[1] * mid[1] > 0.9 * Math.hypot(...mid), 'the yaw looks toward the fighters');
  const turned = otherSideCamera(camera, ra, rb);
  const back = [-Math.sin((turned.yaw * 2 * Math.PI) / 4096), Math.cos((turned.yaw * 2 * Math.PI) / 4096)];
  const midTurned = [(ra[0] + rb[0]) / 2 - turned.eye[0], (ra[2] + rb[2]) / 2 - turned.eye[2]];
  assert.ok(back[0] * midTurned[0] + back[1] * midTurned[1] > 0.9 * Math.hypot(...midTurned), 'and seen from the other side too');
  /* The engine's view from the game's, as the fight view makes it, then turned: its eye the turned camera's. */
  const flip = [1, -1, -1];
  const view = new Float32Array(16);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) view[j * 4 + i] = (flip[i] * state.view.rotation[i * 3 + j] * flip[j]) / 4096;
    view[12 + i] = (flip[i] * state.view.translation[i]) / 1000;
  }
  view[15] = 1;
  otherSideView(view, ra, rb);
  /* Across the floor (the view and the drawn camera place the eye at heights of their own). */
  const eye = [0, 1, 2].map((i) => -(view[i * 4] * view[12] + view[i * 4 + 1] * view[13] + view[i * 4 + 2] * view[14]));
  const turnedEye = engine(turned.eye);
  near([eye[0], eye[2]], [turnedEye[0], turnedEye[2]], 0.05, "the view's eye the turned camera's");
});
