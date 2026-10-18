/**
 * An online fight seen from the other side of the stage (as the player whose side is the other one's
 * sees it): the game's camera turned half round the point it looks at, its focus, so it moves as the
 * game's camera moves, turning as it turns, and each fighter stands where the other stood; the game's
 * camera, for the scenery's layout, turned alike.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { focusOf, otherSideCamera, otherSideView } from '../src/present/3d/other-side.ts';

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

test('turned half round its focus, the camera sees each fighter where the other stood, the far side of the stage behind them, a camera like any other', () => {
  /* The fighters across the view, the focus between them. */
  const [a, b] = [[-1000, -1000, 0], [1000, -1000, 0]];
  const focus = [0, 0];
  const view = lookAt([0.3, 1.6, 3], engine([0, -1000, 0]));
  const turned = Float32Array.from(view);
  otherSideView(turned, focus);
  const [pa, pb] = [apply(view, engine(a)), apply(view, engine(b))];
  const [qa, qb] = [apply(turned, engine(a)), apply(turned, engine(b))];
  assert.ok(pa[0] < 0 && pb[0] > 0, 'the first on the left as the game sees it');
  near(qa, pb, 1e-5, 'the first where the second stood');
  near(qb, pa, 1e-5, 'the second where the first stood');
  const r = turned;
  const det = r[0] * (r[5] * r[10] - r[9] * r[6]) - r[4] * (r[1] * r[10] - r[9] * r[2]) + r[8] * (r[1] * r[6] - r[5] * r[2]);
  assert.ok(Math.abs(det - 1) < 1e-5, `a turn, not a mirror (${det})`);
  const behind = engine([0, -1000, 6000]);
  assert.ok(apply(view, behind)[2] < -5, 'behind the fighters as the game sees them');
  assert.ok(apply(turned, behind)[2] > 0, 'behind the camera seen from the other side');
});

test("the game's camera turned half round its focus: its eye across it at its height, its yaw half a turn on, its pitch kept, whatever the fighters do", () => {
  const camera = { eye: [300, -1200, 3000], yaw: 0x800, pitch: 0x20 };
  const turned = otherSideCamera(camera, [300, 500]);
  near(turned.eye, [300, -1200, -2000], 1e-9, 'across its focus');
  assert.deepEqual([turned.yaw, turned.pitch], [0, 0x20]);
  assert.equal(otherSideCamera({ ...camera, yaw: 0x123 }, [0, 0]).yaw, 0x923, 'its yaw half a turn on, turning as the game turns');
});

test("a camera's focus is the game's: along its view at the mean of its eye's distances to the two points it tracks, across the floor", () => {
  /* Looking along +z (yaw 0 looks along minus its sine and its cosine), level. */
  const camera = { eye: [0, -1000, -3000], yaw: 0, pitch: 0 };
  const tracked = [{ at: [-1000, -1000, 0] }, { at: [1000, -1000, 0] }];
  const focus = focusOf(camera, tracked);
  near(focus, [0, -3000 + Math.hypot(1000, 3000)], 1e-6, 'the mean distance along the view');
});

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';

test("on a fight from the imported data, the turned camera and the turned view agree, and both look at the fighters", { skip }, async () => {
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
  const focus = focusOf(camera, state.camera.tracked);
  const turned = otherSideCamera(camera, focus);
  const looks = (cam) => {
    const yaw = (cam.yaw * 2 * Math.PI) / 4096;
    const along = [-Math.sin(yaw), Math.cos(yaw)];
    const mid = [(ra[0] + rb[0]) / 2 - cam.eye[0], (ra[2] + rb[2]) / 2 - cam.eye[2]];
    return (along[0] * mid[0] + along[1] * mid[1]) / Math.hypot(...mid);
  };
  assert.ok(looks(camera) > 0.9 && looks(turned) > 0.9, `both look at the fighters (${looks(camera)}, ${looks(turned)})`);
  /* The engine's view from the game's, as the fight view makes it, then turned: its eye the turned camera's, across the floor. */
  const flip = [1, -1, -1];
  const view = new Float32Array(16);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) view[j * 4 + i] = (flip[i] * state.view.rotation[i * 3 + j] * flip[j]) / 4096;
    view[12 + i] = (flip[i] * state.view.translation[i]) / 1000;
  }
  view[15] = 1;
  otherSideView(view, focus);
  const eye = [0, 1, 2].map((i) => -(view[i * 4] * view[12] + view[i * 4 + 1] * view[13] + view[i * 4 + 2] * view[14]));
  const turnedEye = engine(turned.eye);
  near([eye[0], eye[2]], [turnedEye[0], turnedEye[2]], 0.05, "the view's eye the turned camera's");
});
