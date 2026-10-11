/**
 * Where the arena's pieces go this frame, worked out from the fight's state as the game lays them
 * for drawing. The scenery stands at the fighters' midpoint (one fighter averaged over four frames
 * while the camera holds on the other's spin), at the stage's height, turned by the yaw the fight
 * keeps; of its 6 × 6 cells only those the view can see past the fighters are drawn. The ground is
 * a 10 × 10 patch of 1800 mm tiles snapped around the fighters (or, under a high camera, where the
 * view's lower edge meets the floor), its tiles taken from the stage's map by position, each corner
 * shaded darker with its depth past the fighters. A view wider than the game's 4:3 widens the
 * culling and lays extra rings of tiles, continuing the map as it repeats.
 */
import type { ArenaTables, StageLayout } from '../../assets/arena.ts';
import { libraryRoot, tableRoot } from '../../sim/math/roots.ts';
import { fighterLockedOn } from '../../sim/fight/camera.ts';
import type { FightData, FightState } from '../../sim/fight/state.ts';
import type { GroundState } from './stage/ground.ts';

const TILE = 1800;
const MAP = 10;
const MAX_RINGS = 10;
const MAX_QUADS = (MAP + 2 * MAX_RINGS) ** 2;
/** The game's picture: half its width in pixels, the culling's view angle at it (4096ths), the attract intro's. */
const HALF_WIDTH = 192;
const CULLING = 600;
const ATTRACT_CULLING = 0x30c;

const q12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;
const s16 = (v: number): number => (v << 16) >> 16;

/** Where the scenery stands, its yaw (4096ths), and which of its 36 cells are drawn. */
export interface SceneryLayout {
  x: number;
  y: number;
  z: number;
  yaw: number;
  readonly cells: Int8Array;
}

export const newScenery = (): SceneryLayout => ({ x: 0, y: 0, z: 0, yaw: 0, cells: new Int8Array(36) });

export const newGround = (): GroundState & { drawn: boolean; count: number } => ({
  drawn: false,
  count: 0,
  cell: new Int16Array(MAX_QUADS),
  x: new Int32Array(MAX_QUADS * 4),
  z: new Int32Array(MAX_QUADS * 4),
  shade: new Uint8Array(MAX_QUADS * 4),
});

/** The view's width over the game's 4:3, at least 1. */
export interface View {
  readonly widening: number;
}

class Trig {
  constructor(private readonly sine: Int16Array) {}
  sin(i: number): number {
    return this.sine[i & 0xfff]!;
  }
  cos(i: number): number {
    return this.sine[(i & 0xfff) + 0x400]!;
  }
}

/** The culling's view angle for this width: the game's 600 plus the angle a wider picture adds each side. */
function cullingAngle(state: FightState, view: View): number {
  const h = state.screen.distance || 500;
  const game = Math.atan(HALF_WIDTH / h);
  const wide = Math.atan((HALF_WIDTH * Math.max(1, view.widening)) / h);
  return CULLING + Math.round(((wide - game) * 2 * 4096) / (2 * Math.PI));
}

/** The scenery cells the view can see past the fighters (`yaw` the view's against the scenery's, the camera at `cx`, `cz` in its frame). */
function cullScenery(trig: Trig, arena: ArenaTables, fov: number, yaw: number, cx: number, cz: number, size: number, out: Int8Array): void {
  const cell = size * 10;
  const gridX = size * -0x1e;
  const gridZ = size * -0x1e;
  const rayStep = Math.trunc((size * 0x8c) / 0x14);
  out.fill(0);
  if (cx < cell * -2) cx = cell * -3;
  if (cell * 2 <= cx) cx = cell * 3 - 1;
  if (cz < cell * -2) cz = cell * -3;
  if (cell * 2 <= cz) cz = cell * 3 - 1;
  const mark = (row: number, column: number, v: number): void => {
    out[arena.gridCells[row * 6 + column]!] = v;
  };
  const ray = (angle: number): [number, number] => {
    const dx = (rayStep * trig.sin(angle)) >> 15;
    const dz = (rayStep * trig.cos(angle)) >> 15;
    let x = cx - gridX;
    let z = cz - gridZ;
    let last: [number, number] = [-1, -1];
    for (;;) {
      const column = Math.trunc(x / cell);
      const row = Math.trunc(z / cell);
      if (!(column >>> 0 < 6)) break;
      x += dx;
      if (!(row >>> 0 < 6)) break;
      last = [row, column];
      mark(row, column, 1);
      z += dz;
    }
    return last;
  };
  let [row, column] = ray(-yaw - (fov >> 1));
  const [endRow, endColumn] = ray(-yaw + (fov >> 1));
  for (let guard = 0; guard <= 100; guard += 1) {
    if (row === 5 && column < 5) {
      column += 1;
      mark(5, column, 1);
      if (column === endColumn && endRow === 5) break;
    }
    if (column === 5 && 0 < row) {
      row -= 1;
      mark(row, 5, 1);
      if (row === endRow && endColumn === 5) break;
    }
    if (row === 0 && 0 < column) {
      column -= 1;
      mark(0, column, 1);
      if (column === endColumn && endRow === 0) break;
    }
    if (column !== 0 || !(row < 5)) continue;
    row += 1;
    mark(row, 0, 1);
    if (row === endRow && endColumn === 0) break;
  }
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      if (out[r * 6 + c] === 0) continue;
      for (let far = 5; c < far; far -= 1) if (out[r * 6 + far] !== 0) for (let k = c; k < far; k += 1) out[r * 6 + k] = 1;
    }
  }
  const camColumn = Math.trunc((cx - gridX) / cell);
  const camRow = Math.trunc((cz - gridZ) / cell);
  out[camRow * 6 + camColumn] = -2;
  const distance = (c: number, r: number): number => (out[r * 6 + c] === 0 ? 0x7fff : Math.abs(c - camColumn) + Math.abs(r - camRow));
  let nearest = 0x7fff;
  for (const [c, r] of [[2, 2], [2, 3], [3, 2], [3, 3]] as const) nearest = Math.min(nearest, distance(c, r));
  for (let r = 0; r < 6; r += 1) for (let c = 0; c < 6; c += 1) if (out[r * 6 + c] !== 0 && distance(c, r) <= nearest) out[r * 6 + c] = 0;
}

/** The scenery's place this frame and its cells in view. */
export function layScenery(state: FightState, data: FightData, arena: ArenaTables, stage: StageLayout, view: View, out: SceneryLayout): void {
  if (state.nothingDrawn !== 0) return;
  const trig = new Trig(data.math.sine);
  const [a, b] = state.fighters;
  const rootA = a.skeleton.base.translation;
  const rootB = b.skeleton.base.translation;
  const roots = state.scenery.roots;
  const average = (side: number, axis: 'x' | 'z'): number => (roots[side]![0]![axis] + roots[side]![1]![axis] + roots[side]![2]![axis] + roots[side]![3]![axis]) >> 2;
  const lock = fighterLockedOn(state, data);
  if (lock === 0) {
    out.x = (average(0, 'x') + rootB[0]!) >> 1;
    out.z = (average(0, 'z') + rootB[2]!) >> 1;
  } else if (lock === 1) {
    out.x = (average(1, 'x') + rootA[0]!) >> 1;
    out.z = (average(1, 'z') + rootA[2]!) >> 1;
  } else {
    out.x = (rootB[0]! + rootA[0]!) >> 1;
    out.z = (rootB[2]! + rootA[2]!) >> 1;
  }
  out.y = arena.stageHeights[state.stage] ?? 0;
  out.yaw = state.scenery.yaw;
  const eye = state.camera.drawn.eye;
  const [camX, camY, camZ] = [eye[0]!, eye[1]!, eye[2]!];
  const offX = s16(camX - (s16(rootA[0]!) + s16((rootB[0]! - rootA[0]!) >> 1)));
  const offZ = s16(camZ - (s16(rootA[2]!) + s16((rootB[2]! - rootA[2]!) >> 1)));
  const turn = state.scenery.yaw & 0xfff;
  const rx = (trig.cos(turn) * offX + trig.sin(turn) * offZ) >> 12;
  const rz = (-trig.sin(turn) * offX + trig.cos(turn) * offZ) >> 12;
  const yaw = state.camera.drawn.yaw - state.scenery.yaw;
  const cells = out.cells;
  if (state.attractIntro !== 0) {
    cullScenery(trig, arena, ATTRACT_CULLING, yaw, rx, rz, stage.cellSize, cells);
    const low = -0x641 < camY ? 1 : 0;
    for (const k of [28, 22, 16, 10]) cells[k] = low;
    const centre = -0x7d1 < camY ? 1 : 0;
    for (const k of [14, 15, 20, 21]) cells[k] = centre;
  } else {
    cullScenery(trig, arena, cullingAngle(state, view), yaw, rx, rz, stage.cellSize, cells);
    const far = 9999 < tableRoot((Math.imul(camX, camX) + Math.imul(camZ, camZ)) | 0, data.math);
    const centre = -0x1389 < camY && (-0xaf1 < camY || far) ? 1 : 0;
    for (const k of [14, 15, 20, 21]) cells[k] = centre;
  }
}

/** Under a high camera, the patch goes where the view's lower edge meets the floor. */
function highCentre(trig: Trig, state: FightState, data: FightData): [number, number] {
  const drawn = state.camera.drawn;
  const [camX, camY, camZ] = [drawn.eye[0]!, drawn.eye[1]!, drawn.eye[2]!];
  const u = (drawn.pitch + 0xef) & 0xfff;
  const reach = Math.trunc((Math.abs(camY) * trig.cos(u)) / trig.sin(u));
  const half = Math.trunc((TILE * MAP) / 2);
  let dist = tableRoot((Math.imul(reach, reach) + Math.imul(camY, camY)) | 0, data.math);
  const yaw = (drawn.yaw + 0x400) & 0xfff;
  const c = trig.cos(yaw);
  const s = trig.sin(yaw);
  dist = Math.trunc((dist * 0xb8) / 0x218);
  const x0 = camX + q12(reach * c);
  const z0 = camZ + q12(reach * s);
  const q = (drawn.yaw + 0x600) & 0xfff;
  const sector = q >> 10;
  const flip = (q >> 9) & 1;
  const lim = q12((-0x4ce - camY) * Math.trunc((TILE << 12) / 300));
  const limit = Math.min(lim, half);
  const along = (f: number): number => (flip === 0 ? -q12(dist * f) : q12(dist * f));
  if (sector === 1 || sector === 3) {
    const z = z0 + along(c) + (sector === 1 ? -Math.trunc(TILE / 2) + limit : Math.trunc(TILE / 2) - limit);
    return [Math.trunc((c * (z - camZ)) / s) + camX, z];
  }
  const x = x0 - along(s) + (sector === 0 ? -Math.trunc(TILE / 2) + limit : Math.trunc(TILE / 2) - limit);
  return [x, Math.trunc((s * (x - camX)) / c) + camZ];
}

/** The ground's centre while it shows: under a high camera looking down, where the view meets the floor; else the fighters' midpoint, a tile back when the view tilts up. */
function groundCentre(trig: Trig, state: FightState, data: FightData): [number, number] | null {
  if (state.groundShown === 0) return null;
  const drawn = state.camera.drawn;
  const pitch = drawn.pitch;
  if ((pitch & 0xfff) !== 0 && (pitch & 0x800) === 0 && drawn.eye[1]! < -0x6b8) return highCentre(trig, state, data);
  const [a, b] = state.fighters;
  let x = ((a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2) | 0;
  let z = ((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2) | 0;
  const tilted = (pitch & 0x800) !== 0 ? (pitch & 0xfff) - 0x1000 : pitch & 0xfff;
  if (tilted < -0x25) {
    const yaw = (drawn.yaw + 0x400) & 0xfff;
    x -= q12(TILE * trig.cos(yaw));
    z -= q12(TILE * trig.sin(yaw));
  }
  return [x, z];
}

/** Floor division as the game corrects C's truncation. */
const tileOf = (v: number): number => Math.trunc(v / TILE) - (v < 0 ? 1 : 0);

/** A point's depth through the view, as the geometry unit saturates it. */
function depthOf(state: FightState, ox: number, oz: number, x: number, z: number): number {
  const r = state.view.rotation;
  const t = state.view.translation;
  const tz = ((Math.imul(r[6]!, ox) + Math.imul(r[8]!, oz)) >> 12) + t[2]!;
  const depth = ((Math.imul(r[6]!, s16(x)) + Math.imul(r[8]!, s16(z))) >> 12) + tz;
  return depth < 0 ? 0 : depth > 0xffff ? 0xffff : depth;
}

/** The ground's patch this frame: each quad's map cell, its corners (mm) and their shades (128 unchanged). */
export function layGround(state: FightState, data: FightData, arena: ArenaTables, stage: StageLayout, view: View, out: ReturnType<typeof newGround>): void {
  const trig = new Trig(data.math.sine);
  const centre = groundCentre(trig, state, data);
  out.drawn = centre !== null;
  if (centre === null) return;
  const ix = tileOf(centre[0] + TILE / 2);
  const iz = tileOf(centre[1] + TILE / 2);
  const ox = ix * TILE;
  const oz = iz * TILE;
  let column = ix % MAP;
  if (column < 0) column += MAP;
  let row = iz % MAP;
  if (row < 0) row += MAP;
  row = MAP - (row + 1);
  const [a, b] = state.fighters;
  const eye = state.camera.drawn.eye;
  const dx = eye[0]! - (((a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2) | 0);
  const dz = eye[2]! - (((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2) | 0);
  const reference = libraryRoot((Math.imul(dx, dx) + Math.imul(dz, dz)) | 0, data.math);
  const fade = state.groundFade === 0 ? 1 : state.groundFade;
  const shadeAt = (depth: number): number => {
    if (stage.shadeStrength === 0) return 0x80;
    let past = depth - reference;
    if (past < 0) past = 0;
    let at = (past * Math.trunc(0x4000000 / fade)) >> 16;
    if (!(at < 0x400)) at = 0x3ff;
    const shade = ((arena.shades[at]! * stage.shadeStrength) >> 7) + 0x80;
    return shade < 0 ? 0 : 0xfe < shade ? 0xfe : shade;
  };
  const depths = arena.ground.vertices.map(([x, z]) => depthOf(state, ox, oz, x, z));
  let mapRow = row;
  for (let r = 0; r < MAP; r += 1) {
    let mapColumn = column;
    for (let c = 0; c < MAP; c += 1) {
      const quad = r * MAP + c;
      out.cell[quad] = mapRow * MAP + mapColumn;
      const corners = arena.ground.quads[quad]!;
      for (let k = 0; k < 4; k += 1) {
        const [x, z] = arena.ground.vertices[corners[k]!]!;
        out.x[quad * 4 + k] = x + ox;
        out.z[quad * 4 + k] = z + oz;
        out.shade[quad * 4 + k] = shadeAt(depths[corners[k]!]!);
      }
      mapColumn = mapColumn + 1 < MAP ? mapColumn + 1 : 0;
    }
    mapRow = mapRow - 1 < 0 ? MAP - 1 : mapRow - 1;
  }
  out.count = MAP * MAP;
  const rings = view.widening <= 1 ? 0 : Math.min(MAX_RINGS, Math.ceil(5 * (view.widening - 1)) + 1);
  const wrap = (v: number, n: number): number => ((v % n) + n) % n;
  let quad = out.count;
  for (let r = -rings; r < MAP + rings; r += 1) {
    for (let c = -rings; c < MAP + rings; c += 1) {
      if (0 <= r && r < MAP && 0 <= c && c < MAP) continue;
      const x0 = ox - 9000 + c * TILE;
      const z0 = oz - 9000 + r * TILE;
      out.cell[quad] = wrap(row - r, MAP) * MAP + wrap(column + c, MAP);
      const corners = [[x0, z0 + TILE], [x0 + TILE, z0 + TILE], [x0, z0], [x0 + TILE, z0]] as const;
      corners.forEach(([x, z], k) => {
        out.x[quad * 4 + k] = x;
        out.z[quad * 4 + k] = z;
        out.shade[quad * 4 + k] = shadeAt(depthOf(state, ox, oz, x - ox, z - oz));
      });
      quad += 1;
    }
  }
  out.count = quad;
}
