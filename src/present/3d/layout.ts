/**
 * Where the arena's pieces go this frame, worked out from the fight's state as the game lays them
 * for drawing. The scenery stands at the fighters' midpoint (one fighter averaged over four frames
 * while the camera holds on the other's spin), at the stage's height, turned by the yaw the fight
 * keeps; of its 6 × 6 cells only those the view can see past the fighters are drawn, of an arcade
 * stage's 16 × 16 all but those the board hides near the camera, each fading in or out over a few
 * fields where the game shows or hides it at once, and at once on a cut. The ground is
 * a 10 × 10 patch of 1800 mm tiles snapped around the fighters (or, under a high camera, where the
 * view's lower edge meets the floor), its tiles taken from the stage's map by position, each corner
 * shaded darker with its depth past the fighters. Some stages light their floor instead: a light
 * at each fighter's feet, or one over their midpoint, brightest within a couple of metres and
 * fading by the square of the distance, so the floor sinks into the dark beyond the patch, which
 * is then always laid round the fighters' midpoint; with True Ogre in the match a floor shaded by
 * depth takes the midpoint's light. A view wider than the game's 4:3 widens the culling and lays
 * extra rings of tiles, continuing the map as it repeats; an arcade stage's patch reaches as far as
 * the board's floor, laid round where its scenery stands, and is drawn under the scenery, as the
 * board paints its stage over its floor. Tekken Force lays a wider patch, 10 × 3
 * tiles of 2500 mm, from its own template and the first three rows of the map, always at the same
 * depth, its shade by depth measured from the camera's own distance, its dark stage lit at the
 * player's feet (the patch laid round them, none of it past the backdrop, which lies over it) and
 * its final stage lit ahead of the camera.
 */
import type { ArenaTables, GroundTemplate, StageLayout } from '../../assets/arena.ts';
import { libraryRoot, tableRoot } from '../../sim/math/roots.ts';
import { FIRST_ACCESSORY } from '../../sim/fight/accessories.ts';
import { fighterLockedOn } from '../../sim/fight/camera.ts';
import type { FightData, FightState } from '../../sim/fight/state.ts';
import { WALL_REACH } from '../../sim/fight/walls.ts';
import { GroundLight, groundLighting, litShade } from './ground-light.ts';
import type { DrawnCamera } from './other-side.ts';
import type { GroundState } from './stage/ground.ts';

const TILE = 1800;
const MAP = 10;
/** A fight's ground tile's side (mm). */
export const GROUND_TILE = TILE;
/**
 * Tekken Force's patch: its tiles, its map's rows, the depth it is laid at, where its final stage's
 * light stands in depth, and the depth its backdrop stands at, which lies over the floor past it.
 */
const FORCE = { tile: 2500, rows: 3, z: 0x145, lightZ: -2000, backdrop: 2500 } as const;
const TEKKEN_FORCE = 8;
/** Rings of tiles past the patch, on a wide picture: at most. */
const MAX_RINGS = 10;
const MAX_QUADS = (MAP + 2 * MAX_RINGS) ** 2;
/** The game's picture: half its width in pixels, the culling's view angle at it (4096ths), the attract intro's. */
const HALF_WIDTH = 192;
const CULLING = 600;
const ATTRACT_CULLING = 0x30c;

const q12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;
const s16 = (v: number): number => (v << 16) >> 16;

/** The most cells a scenery's grid has: an arcade stage's 16 × 16. */
const MAX_CELLS = 256;
/** The disc's scenery grid, whose cells the game numbers in an order of its own. */
const DISC_GRID = 6;

/** Where the scenery stands, its yaw (4096ths), and which of its cells are drawn. */
export interface SceneryLayout {
  x: number;
  y: number;
  z: number;
  yaw: number;
  readonly cells: Int8Array;
}

export const newScenery = (): SceneryLayout => ({ x: 0, y: 0, z: 0, yaw: 0, cells: new Int8Array(MAX_CELLS) });

/** A scenery's grid: its cells' size (the model's units) and how many each way. */
export interface SceneryGrid {
  readonly cellSize: number;
  readonly grid: number;
}

/**
 * A scenery held still on the floor: it stays where it stands while the place the game gives it
 * is within `radius` (mm) and its turn within `slack` (4096ths), and moves only by as far as that
 * place goes past them, so walls stand on the floor rather than sliding over it as the fighters
 * move; it stands at the game's place before a round starts and as it starts, and goes straight
 * to it when that jumps (a replay's cut).
 */
export interface HeldScenery {
  readonly radius: number;
  readonly slack: number;
  x: number;
  z: number;
  yaw: number;
  last: { x: number; z: number; yaw: number } | null;
  /** The round's step the scenery was last laid at. */
  flow: number;
}

export const newHeldScenery = (radius: number, slack: number): HeldScenery => ({ radius, slack, x: 0, z: 0, yaw: 0, last: null, flow: -1 });

/** How far under the fight's floor an arcade stage's own floors lie (mm), which are drawn over it as the board paints its stage over its floor. */
const ARCADE_DEPTH = 20;
/** Rings of tiles past an arcade stage's patch: as far as the board's floor reaches, ten of its 2.5 m tiles across; one more under a stage fixed in place, drawn larger. */
const ARCADE_RINGS = 2;

/** How far the game's place moves in a frame, or its turn, past which it has jumped rather than moved (mm, 4096ths). */
const JUMP = 1500;
const JUMP_YAW = 0x200;

const turnOf = (a: number): number => ((a + 0x800) & 0xfff) - 0x800;

/** The scenery held (`reset`: taken to the game's place, as before a round starts and as it starts). */
function hold(out: SceneryLayout, held: HeldScenery, reset: boolean): void {
  const last = held.last;
  const jumped = reset || last === null || Math.hypot(out.x - last.x, out.z - last.z) > JUMP || Math.abs(turnOf(out.yaw - last.yaw)) > JUMP_YAW;
  held.last = { x: out.x, z: out.z, yaw: out.yaw };
  if (jumped) {
    held.x = out.x;
    held.z = out.z;
    held.yaw = out.yaw;
  } else {
    const dx = out.x - held.x;
    const dz = out.z - held.z;
    const d = Math.hypot(dx, dz);
    if (d > held.radius) {
      held.x += dx * (1 - held.radius / d);
      held.z += dz * (1 - held.radius / d);
    }
    const turn = turnOf(out.yaw - held.yaw);
    if (Math.abs(turn) > held.slack) held.yaw = (held.yaw + turn - Math.sign(turn) * held.slack) & 0xfff;
  }
  out.x = Math.round(held.x);
  out.z = Math.round(held.z);
  out.yaw = held.yaw;
}

/** The ground laid this frame, and the shade it gives a point on the floor anywhere (null while none is laid). */
export type GroundLayout = GroundState & { drawn: boolean; count: number; shadeOf: ((x: number, z: number) => number) | null };

export const newGround = (): GroundLayout => ({
  drawn: false,
  count: 0,
  shadeOf: null,
  cell: new Int16Array(MAX_QUADS),
  x: new Int32Array(MAX_QUADS * 4),
  z: new Int32Array(MAX_QUADS * 4),
  shade: new Uint8Array(MAX_QUADS * 4),
});

/**
 * The view's width over the game's 4:3, at least 1; and, where the remake's walls stand, the stage
 * fixed in place at the middle, drawn `scale` times its size.
 */
export interface View {
  readonly widening: number;
  readonly fixed?: { readonly scale: number };
  /** The camera as drawn, where it is not the game's (an online fight seen from the other side, `other-side.ts`). */
  readonly camera?: DrawnCamera;
}

/** The camera the scenery and the floor are laid for: the one drawn, the game's but where the view says otherwise. */
const cameraOf = (state: FightState, view?: View): DrawnCamera => view?.camera ?? state.camera.drawn;

/** Whether a point (the game's x and z) stands inside the remake's eight-sided walls, each side `reach` from the middle. */
export const insideWalls = (x: number, z: number, reach: number): boolean => Math.abs(x) <= reach && Math.abs(z) <= reach && Math.abs(x) + Math.abs(z) <= reach * Math.SQRT2;

class Trig {
  private readonly sine: Int16Array;
  constructor(sine: Int16Array) {
    this.sine = sine;
  }
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

/**
 * The scenery cells the view can see past the fighters (`yaw` the view's against the scenery's, the
 * camera at `cx`, `cz` in its frame), on a grid of `n` × `n` cells about the fighters: the cells two
 * rays from the camera cross at the view's edges, the grid's border between where they leave it,
 * each row filled between its outermost cells, then the camera's cell and every cell no farther
 * from it than the nearest of the four around the fighters left out. An arcade grid starts from
 * every cell, which the GPU clips: its cells' polygons reach past their squares, so a cell beside
 * the rays can still be in the picture. Where the scenery is fixed in place, the fighters stand at
 * `fixed.fighters` (in its frame, as the camera is), and only the cells between the camera and
 * them are left out (`hideBetween`).
 */
function cullScenery(trig: Trig, arena: ArenaTables, fov: number, yaw: number, cx: number, cz: number, { cellSize: size, grid: n }: SceneryGrid, out: Int8Array, fixed?: FixedView): void {
  const half = n >> 1;
  const last = n - 1;
  /* The disc's grid is the game's, ten units a model unit; an arcade grid's cells are the drawn ones, eight. */
  const cell = size * (n === DISC_GRID ? 10 : 8);
  const gridX = -cell * half;
  const gridZ = -cell * half;
  const rayStep = Math.trunc((size * 0x8c) / 0x14);
  /* Fixed in place, every cell starts drawn (the camera then going where the disc's rays were never cast from), and the cells crossed are found in the drawn cells' own size (the disc's culling counts ten units a cell, its drawn cells eight). */
  if (fixed !== undefined) {
    const drawn = size * 8;
    out.fill(1);
    hideBetween(out, n, drawn, -drawn * half, -drawn * half, cx, cz, fixed, n !== DISC_GRID);
    return;
  }
  out.fill(0);
  if (cx < cell * -(half - 1)) cx = cell * -half;
  if (cell * (half - 1) <= cx) cx = cell * half - 1;
  if (cz < cell * -(half - 1)) cz = cell * -half;
  if (cell * (half - 1) <= cz) cz = cell * half - 1;
  const mark = (row: number, column: number, v: number): void => {
    out[n === DISC_GRID ? arena.gridCells[row * n + column]! : row * n + column] = v;
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
      if (!(column >>> 0 < n)) break;
      x += dx;
      if (!(row >>> 0 < n)) break;
      last = [row, column];
      mark(row, column, 1);
      z += dz;
    }
    return last;
  };
  const hide = (): void => hideNear(out, n, half, cell, gridX, gridZ, cx, cz);
  /* An arcade grid starts from every cell. */
  if (n !== DISC_GRID) {
    out.fill(1);
    hide();
    return;
  }
  let [row, column] = ray(-yaw - (fov >> 1));
  const [endRow, endColumn] = ray(-yaw + (fov >> 1));
  for (let guard = 0; guard <= 100 * (n / DISC_GRID) ** 2; guard += 1) {
    if (row === last && column < last) {
      column += 1;
      mark(last, column, 1);
      if (column === endColumn && endRow === last) break;
    }
    if (column === last && 0 < row) {
      row -= 1;
      mark(row, last, 1);
      if (row === endRow && endColumn === last) break;
    }
    if (row === 0 && 0 < column) {
      column -= 1;
      mark(0, column, 1);
      if (column === endColumn && endRow === 0) break;
    }
    if (column !== 0 || !(row < last)) continue;
    row += 1;
    mark(row, 0, 1);
    if (row === endRow && endColumn === 0) break;
  }
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < last; c += 1) {
      if (out[r * n + c] === 0) continue;
      for (let far = last; c < far; far -= 1) if (out[r * n + far] !== 0) for (let k = c; k < far; k += 1) out[r * n + k] = 1;
    }
  }
  hide();
}

/** The fighters' places in a fixed scenery's frame, how near them a line from the camera stops (what stands by them is never between), whether the camera is inside the walls, and how far they stand from the middle in that frame. */
interface FixedView {
  readonly fighters: readonly (readonly [number, number])[];
  readonly short: number;
  readonly inside: boolean;
  readonly reach: number;
}

/** How far short of the fighters the lines from the camera stop (mm). */
const BY_FIGHTERS = 1500;

/** Points taken along each line from the camera to a fighter, finding the cells it crosses. */
const LINE_SAMPLES = 32;

/**
 * A fixed scenery's cells left out. With the camera inside the walls none: only the stage's own
 * props could stand between it and the fighters, and a cell is too coarse to tell a wall beside the
 * camera's line from one across it. With the camera past them, those the lines from the camera to
 * each fighter cross: on an arcade grid stopping `short` of either fighter and keeping the
 * fighters' own cells (`keepOwn`), whose floors they stand on, and with them every cell whose
 * middle lies nearer the camera, along its view to the fighters, than the nearer of them less
 * `short`, and every one, theirs too, whose middle lies past the walls nearer than the farther (the
 * fight's floor under them), so the wall between goes, and what of it and past it stands beside
 * the lines at the picture's edge, while what stands beside and behind the fighters inside the
 * walls stays; on the disc's every cell crossed, its
 * walls the panels of its border cells, just behind a fighter at the walls, and its floor its own
 * ground.
 */
function hideBetween(out: Int8Array, n: number, cell: number, gridX: number, gridZ: number, cx: number, cz: number, { fighters, short, inside, reach }: FixedView, keepOwn: boolean): void {
  if (inside) return;
  const cellAt = (x: number, z: number): number => {
    const column = Math.floor((x - gridX) / cell);
    const row = Math.floor((z - gridZ) / cell);
    return column >>> 0 < n && row >>> 0 < n ? row * n + column : -1;
  };
  const own = new Set(keepOwn ? fighters.map(([x, z]) => cellAt(x, z)) : []);
  const nearOne = (x: number, z: number): boolean => keepOwn && fighters.some(([fx, fz]) => Math.hypot(x - fx, z - fz) < short);
  for (const [fx, fz] of fighters) {
    for (let k = 0; k <= LINE_SAMPLES; k += 1) {
      const [x, z] = [cx + ((fx - cx) * k) / LINE_SAMPLES, cz + ((fz - cz) * k) / LINE_SAMPLES];
      if (nearOne(x, z)) continue;
      const at = cellAt(x, z);
      if (at < 0 || own.has(at)) continue;
      out[at] = 0;
    }
  }
  if (!keepOwn) return;
  /* Along the view from the camera to the fighters' midpoint: how far each fighter stands, and each cell's middle. */
  const [mx, mz] = [(fighters[0]![0] + fighters[1]![0]) / 2, (fighters[0]![1] + fighters[1]![1]) / 2];
  const length = Math.hypot(mx - cx, mz - cz) || 1;
  const depth = (x: number, z: number): number => ((x - cx) * (mx - cx) + (z - cz) * (mz - cz)) / length;
  const depths = fighters.map(([fx, fz]) => depth(fx, fz));
  const [nearer, farther] = [Math.min(...depths) - short, Math.max(...depths)];
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const at = row * n + column;
      const [x, z] = [gridX + (column + 0.5) * cell, gridZ + (row + 0.5) * cell];
      const d = depth(x, z);
      if ((!own.has(at) && d < nearer) || (d < farther && !insideWalls(x, z, reach))) out[at] = 0;
    }
  }
}

/** The camera's cell left out, and every cell no farther from it than the nearest of the four around the fighters. */
function hideNear(out: Int8Array, n: number, half: number, cell: number, gridX: number, gridZ: number, cx: number, cz: number): void {
  const camColumn = Math.trunc((cx - gridX) / cell);
  const camRow = Math.trunc((cz - gridZ) / cell);
  out[camRow * n + camColumn] = -2;
  const distance = (c: number, r: number): number => (out[r * n + c] === 0 ? 0x7fff : Math.abs(c - camColumn) + Math.abs(r - camRow));
  let nearest = 0x7fff;
  for (const [c, r] of [[half - 1, half - 1], [half - 1, half], [half, half - 1], [half, half]] as const) nearest = Math.min(nearest, distance(c, r));
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (out[r * n + c] !== 0 && distance(c, r) <= nearest) out[r * n + c] = 0;
}

/** The scenery's place this frame and its cells in view. */
export function layScenery(state: FightState, data: FightData, arena: ArenaTables, scenery: SceneryGrid, view: View, out: SceneryLayout, held?: HeldScenery): void {
  if (state.nothingDrawn !== 0) return;
  const trig = new Trig(data.math.sine);
  const [a, b] = state.fighters;
  const rootA = a.skeleton.base.translation;
  const rootB = b.skeleton.base.translation;
  const roots = state.scenery.roots;
  const average = (side: number, axis: 'x' | 'z'): number => (roots[side]![0]![axis] + roots[side]![1]![axis] + roots[side]![2]![axis] + roots[side]![3]![axis]) >> 2;
  const lock = fighterLockedOn(state, data);
  const fixed = view.fixed;
  if (state.sceneryAtOrigin !== 0 || fixed !== undefined) {
    out.x = 0;
    out.z = 0;
  } else if (lock === 0) {
    out.x = (average(0, 'x') + rootB[0]!) >> 1;
    out.z = (average(0, 'z') + rootB[2]!) >> 1;
  } else if (lock === 1) {
    out.x = (average(1, 'x') + rootA[0]!) >> 1;
    out.z = (average(1, 'z') + rootA[2]!) >> 1;
  } else {
    out.x = (rootB[0]! + rootA[0]!) >> 1;
    out.z = (rootB[2]! + rootA[2]!) >> 1;
  }
  /* The disc's scenery stands at the stage's height under the floor; an arcade stage's on the floor, its own floors a little under the fight's. */
  out.y = scenery.grid !== DISC_GRID ? ARCADE_DEPTH : (arena.stageHeights[state.stage] ?? 0);
  out.yaw = state.scenery.yaw;
  const camera = cameraOf(state, view);
  const eye = camera.eye;
  const [camX, camY, camZ] = [eye[0]!, eye[1]!, eye[2]!];
  /* Before a round starts (the fighters set at their places) and as it starts, the scenery stands where the game puts it. */
  if (held !== undefined && fixed === undefined) {
    hold(out, held, state.round.flow === 0 || held.flow === 0);
    held.flow = state.round.flow;
  }
  /* The camera from the scenery's middle: the fighters' midpoint, or where a held or fixed scenery stands. */
  const placed = held !== undefined || fixed !== undefined;
  const offX = placed ? camX - out.x : s16(camX - (s16(rootA[0]!) + s16((rootB[0]! - rootA[0]!) >> 1)));
  const offZ = placed ? camZ - out.z : s16(camZ - (s16(rootA[2]!) + s16((rootB[2]! - rootA[2]!) >> 1)));
  const turn = out.yaw & 0xfff;
  /* In the scenery's own frame: turned with it, and in its own units where it is drawn larger. */
  const scale = fixed?.scale ?? 1;
  const inFrame = (x: number, z: number): [number, number] => [Math.round(((trig.cos(turn) * x + trig.sin(turn) * z) >> 12) / scale), Math.round(((-trig.sin(turn) * x + trig.cos(turn) * z) >> 12) / scale)];
  const [rx, rz] = inFrame(offX, offZ);
  const fixedView: FixedView | undefined = fixed === undefined ? undefined : { fighters: [inFrame(rootA[0]! - out.x, rootA[2]! - out.z), inFrame(rootB[0]! - out.x, rootB[2]! - out.z)], short: BY_FIGHTERS / scale, inside: insideWalls(camX, camZ, WALL_REACH), reach: WALL_REACH / scale };
  const yaw = camera.yaw - out.yaw;
  const cells = out.cells;
  const disc = scenery.grid === DISC_GRID;
  if (state.attractIntro !== 0) {
    cullScenery(trig, arena, ATTRACT_CULLING, yaw, rx, rz, scenery, cells);
    if (!disc) return;
    const low = -0x641 < camY ? 1 : 0;
    for (const k of [28, 22, 16, 10]) cells[k] = low;
    const centre = -0x7d1 < camY ? 1 : 0;
    for (const k of [14, 15, 20, 21]) cells[k] = centre;
  } else {
    cullScenery(trig, arena, cullingAngle(state, view), yaw, rx, rz, scenery, cells, fixedView);
    if (!disc) return;
    const far = 9999 < tableRoot((Math.imul(camX, camX) + Math.imul(camZ, camZ)) | 0, data.math);
    const centre = -0x1389 < camY && (-0xaf1 < camY || far) ? 1 : 0;
    if (fixedView === undefined) for (const k of [14, 15, 20, 21]) cells[k] = centre;
    else if (centre === 0) for (const k of cellsAbout(fixedView.fighters, scenery.cellSize, arena)) cells[k] = 0;
  }
}

/**
 * On the disc's grid fixed in place, the four cells about the fighters' midpoint (in the scenery's
 * frame): those the game draws only while the camera is low, as it does the middle four of a grid
 * that stands about the fighters, so a camera high over them looks through the sky's cover.
 */
function cellsAbout(fighters: FixedView['fighters'], size: number, arena: ArenaTables): number[] {
  const drawn = size * 8;
  const corner = (v: number): number => Math.min(DISC_GRID - 1, Math.max(1, Math.round(v / drawn + DISC_GRID / 2)));
  const column = corner((fighters[0]![0] + fighters[1]![0]) / 2);
  const row = corner((fighters[0]![1] + fighters[1]![1]) / 2);
  return [
    [row - 1, column - 1],
    [row - 1, column],
    [row, column - 1],
    [row, column],
  ].map(([r, c]) => arena.gridCells[r! * DISC_GRID + c!]!);
}

/** How many fields a cell takes to fade in or out. */
const FADE_FIELDS = 10;

/** How much of each scenery cell is drawn (0 to 1), and the camera and scenery it was last faded under. */
export interface SceneryFade {
  readonly shown: Float32Array;
  last: { stage: number; x: number; y: number; z: number; yaw: number; sceneryX: number; sceneryZ: number; sceneryYaw: number } | null;
}

export const newSceneryFade = (): SceneryFade => ({ shown: new Float32Array(MAX_CELLS), last: null });

/**
 * Each cell eased toward what the culling chose for it this field, by a `FADE_FIELDS`th; set at
 * once on a new stage and on a cut, where the camera or the scenery jumps rather than moves.
 */
export function fadeScenery(state: FightState, scenery: SceneryLayout, fade: SceneryFade, camera: DrawnCamera = state.camera.drawn): void {
  const eye = camera.eye;
  const now = { stage: state.stage, x: eye[0]!, y: eye[1]!, z: eye[2]!, yaw: camera.yaw, sceneryX: scenery.x, sceneryZ: scenery.z, sceneryYaw: scenery.yaw };
  const last = fade.last;
  const cut =
    last === null ||
    last.stage !== now.stage ||
    Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) > JUMP ||
    Math.abs(turnOf(now.yaw - last.yaw)) > JUMP_YAW ||
    Math.hypot(now.sceneryX - last.sceneryX, now.sceneryZ - last.sceneryZ) > JUMP ||
    Math.abs(turnOf(now.sceneryYaw - last.sceneryYaw)) > JUMP_YAW;
  fade.last = now;
  const shown = fade.shown;
  scenery.cells.forEach((v, i) => {
    const to = 0 < v ? 1 : 0;
    shown[i] = cut ? to : to > shown[i]! ? Math.min(to, shown[i]! + 1 / FADE_FIELDS) : Math.max(to, shown[i]! - 1 / FADE_FIELDS);
  });
}

/**
 * A ground's patch: its tiles' size, its map's columns and rows, the template it is laid from, and
 * the depth Tekken Force lays it at (null elsewhere).
 */
interface Patch {
  readonly tile: number;
  readonly columns: number;
  readonly rows: number;
  readonly template: GroundTemplate;
  readonly z: number | null;
}

const patchOf = (state: FightState, arena: ArenaTables): Patch =>
  state.mode === TEKKEN_FORCE ? { tile: FORCE.tile, columns: MAP, rows: FORCE.rows, template: arena.forceGround, z: FORCE.z } : { tile: TILE, columns: MAP, rows: MAP, template: arena.ground, z: null };

/** Under a high camera, the patch goes where the view's lower edge meets the floor. */
function highCentre(trig: Trig, data: FightData, tile: number, drawn: DrawnCamera): [number, number] {
  const [camX, camY, camZ] = [drawn.eye[0]!, drawn.eye[1]!, drawn.eye[2]!];
  const u = (drawn.pitch + 0xef) & 0xfff;
  const reach = Math.trunc((Math.abs(camY) * trig.cos(u)) / trig.sin(u));
  const half = Math.trunc((tile * MAP) / 2);
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
  const lim = q12((-0x4ce - camY) * Math.trunc((tile << 12) / 300));
  const limit = Math.min(lim, half);
  const along = (f: number): number => (flip === 0 ? -q12(dist * f) : q12(dist * f));
  if (sector === 1 || sector === 3) {
    const z = z0 + along(c) + (sector === 1 ? -Math.trunc(tile / 2) + limit : Math.trunc(tile / 2) - limit);
    return [Math.trunc((c * (z - camZ)) / s) + camX, z];
  }
  const x = x0 - along(s) + (sector === 0 ? -Math.trunc(tile / 2) + limit : Math.trunc(tile / 2) - limit);
  return [x, Math.trunc((s * (x - camX)) / c) + camZ];
}

/**
 * The ground's centre while it shows: under a high camera looking down, where the view meets the
 * floor; else the fighters' midpoint, a tile back when the view tilts up. Tekken Force's always at
 * its own depth.
 */
function groundCentre(trig: Trig, state: FightState, data: FightData, patch: Patch, drawn: DrawnCamera): [number, number] | null {
  if (state.groundShown === 0) return null;
  const pitch = drawn.pitch;
  const { tile } = patch;
  let centre: [number, number];
  if ((pitch & 0xfff) !== 0 && (pitch & 0x800) === 0 && drawn.eye[1]! < -0x6b8) centre = highCentre(trig, data, tile, drawn);
  else {
    const [a, b] = state.fighters;
    centre = [((a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2) | 0, ((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2) | 0];
    const tilted = (pitch & 0x800) !== 0 ? (pitch & 0xfff) - 0x1000 : pitch & 0xfff;
    if (tilted < -0x25) {
      const yaw = (drawn.yaw + 0x400) & 0xfff;
      centre[0] -= q12(tile * trig.cos(yaw));
      centre[1] -= q12(tile * trig.sin(yaw));
    }
  }
  if (patch.z !== null) centre[1] = patch.z;
  return centre;
}

/** Floor division by the tile as the game corrects C's truncation. */
const tileOf = (v: number, tile: number): number => Math.trunc(v / tile) - (v < 0 ? 1 : 0);

/** A point's depth through the view, as the geometry unit saturates it. */
function depthOf(state: FightState, ox: number, oz: number, x: number, z: number): number {
  const r = state.view.rotation;
  const t = state.view.translation;
  const tz = ((Math.imul(r[6]!, ox) + Math.imul(r[8]!, oz)) >> 12) + t[2]!;
  const depth = ((Math.imul(r[6]!, s16(x)) + Math.imul(r[8]!, s16(z))) >> 12) + tz;
  return depth < 0 ? 0 : depth > 0xffff ? 0xffff : depth;
}

/**
 * A lit floor's point the patch is snapped round (half a tile on): the fighters' midpoint, or in
 * Tekken Force the player's root half a tile further in depth; none while the view looks exactly
 * level with the floor.
 */
function litCentre(trig: Trig, state: FightState, patch: Patch): [number, number] | null {
  if (trig.sin(state.camera.drawn.pitch + 0xef) === 0) return null;
  const [a, b] = state.fighters;
  if (patch.z !== null) return [a.skeleton.base.translation[0]!, (a.skeleton.base.translation[2]! + patch.tile / 2) | 0];
  return [((a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2) | 0, ((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2) | 0];
}

/**
 * Where a lit floor's light stands, with the second fighter's for the two-light kind: the fighters'
 * roots, the player's, or the point ahead of the camera on Tekken Force's final stage.
 */
function lightsOf(state: FightState, kind: number): readonly [readonly number[], readonly number[]] {
  const [a, b] = state.fighters;
  if (kind === GroundLight.CAMERA) return [[state.camera.drawn.eye[0]!, 0, FORCE.lightZ], b.skeleton.base.translation];
  return [a.skeleton.base.translation, b.skeleton.base.translation];
}

/**
 * The ground's patch this frame: each quad's map cell, its corners (mm) and their shades (128
 * unchanged); `arcade` for an arcade stage's floor, laid round `around`, where its scenery stands,
 * as the board's stands round the fighters with its scenery.
 */
export function layGround(state: FightState, data: FightData, arena: ArenaTables, stage: StageLayout, view: View, out: GroundLayout, arcade = false, around: { readonly x: number; readonly z: number } | null = null): void {
  const trig = new Trig(data.math.sine);
  const patch = patchOf(state, arena);
  const { tile, columns, rows, template } = patch;
  const force = patch.z !== null;
  /* The attract intro lays its floor its own way, shaded by depth. */
  const lighting = state.attractIntro !== 0 ? { kind: GroundLight.DEPTH, brightest: 0 } : groundLighting(stage, state.stage, state.match.trueOgres, force && state.force.finalStage !== 0);
  const lit = lighting.kind !== GroundLight.DEPTH;
  const camera = cameraOf(state, view);
  const placed = lit ? litCentre(trig, state, patch) : groundCentre(trig, state, data, patch, camera);
  const centre = placed !== null && around !== null ? ([around.x, around.z] as [number, number]) : placed;
  out.drawn = centre !== null;
  out.shadeOf = null;
  if (centre === null) return;
  const ix = tileOf(centre[0] + tile / 2, tile);
  const iz = tileOf(centre[1] + tile / 2, tile);
  const ox = ix * tile;
  const oz = iz * tile;
  let column = ix % columns;
  if (column < 0) column += columns;
  let row = iz % rows;
  if (row < 0) row += rows;
  row = rows - (row + 1);
  const [a, b] = state.fighters;
  const eye = camera.eye;
  const dx = eye[0]! - (((a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2) | 0);
  const dz = eye[2]! - (((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2) | 0);
  const reference = force ? Math.abs(eye[2]!) : libraryRoot((Math.imul(dx, dx) + Math.imul(dz, dz)) | 0, data.math);
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
  const [lightA, lightB] = lightsOf(state, lighting.kind);
  /* A corner's shade: by its depth, or by the light where it lies. */
  const shadeOf = (x: number, z: number): number => (lit ? litShade(lighting.kind, lighting.brightest, lightA, lightB, x, z) : shadeAt(depthOf(state, ox, oz, x - ox, z - oz)));
  /* A point anywhere on the floor, however far from the patch: its depth taken whole. */
  const r = state.view.rotation;
  const t = state.view.translation;
  out.shadeOf = (x, z) => (lit ? litShade(lighting.kind, lighting.brightest, lightA, lightB, x, z) : shadeAt(Math.min(0xffff, Math.max(0, Math.trunc((r[6]! * x + r[8]! * z) / 4096) + t[2]!))));
  const shades = template.vertices.map(([x, z]) => shadeOf(x + ox, z + oz));
  let mapRow = row;
  for (let r = 0; r < rows; r += 1) {
    let mapColumn = column;
    for (let c = 0; c < columns; c += 1) {
      const quad = r * columns + c;
      out.cell[quad] = mapRow * columns + mapColumn;
      const corners = template.quads[quad]!;
      for (let k = 0; k < 4; k += 1) {
        const [x, z] = template.vertices[corners[k]!]!;
        out.x[quad * 4 + k] = x + ox;
        out.z[quad * 4 + k] = z + oz;
        out.shade[quad * 4 + k] = shades[corners[k]!]!;
      }
      mapColumn = mapColumn + 1 < columns ? mapColumn + 1 : 0;
    }
    mapRow = mapRow - 1 < 0 ? rows - 1 : mapRow - 1;
  }
  out.count = columns * rows;
  /* Tekken Force's patch laid round the player (its dark stage) drops the rows past its backdrop, which the game draws over them. */
  if (force) {
    let kept = 0;
    for (let q = 0; q < out.count; q += 1) {
      if (Math.min(out.z[q * 4]!, out.z[q * 4 + 1]!, out.z[q * 4 + 2]!, out.z[q * 4 + 3]!) >= FORCE.backdrop) continue;
      out.cell[kept] = out.cell[q]!;
      for (let k = 0; k < 4; k += 1) {
        out.x[kept * 4 + k] = out.x[q * 4 + k]!;
        out.z[kept * 4 + k] = out.z[q * 4 + k]!;
        out.shade[kept * 4 + k] = out.shade[q * 4 + k]!;
      }
      kept += 1;
    }
    out.count = kept;
  }
  /*
   * Tekken Force's patch already reaches past the widest view, at a fixed depth. An arcade stage's
   * reaches as far as the board's: past it lie the stage's own floors, and what lies below them.
   */
  const rings = force ? 0 : arcade ? ARCADE_RINGS + (view.fixed === undefined ? 0 : 1) : view.widening <= 1 ? 0 : Math.min(MAX_RINGS, Math.ceil(5 * (view.widening - 1)) + 1);
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
        out.shade[quad * 4 + k] = shadeOf(x, z);
      });
      quad += 1;
    }
  }
  out.count = quad;
}

/**
 * A fighter standing on its feet (its feet its lowest point, within `STANDING`, less and less to
 * `NOT_STANDING`) is set on them on the floor, where the game's poses stand a little above it or
 * sink a little into it: lowered onto it from up to `GROUNDED` metres above it (less and less up to
 * `AIRBORNE`, past which it is drawn where it is), lifted onto it from `MOST_LIFT` below at most. A
 * fighter lying, rolling or thrown is drawn as the game poses it. Its accessories (hair, King's
 * tail), which swing through the floor, are not counted.
 */
const GROUNDED = 0.02;
const AIRBORNE = 0.06;
const MOST_LIFT = 0.03;
const STANDING = 0.02;
const NOT_STANDING = 0.06;
/** The joints the feet hang on. */
export const FEET = new Set([14, 17]);
/** The joints the accessories swing on, the six from the first. */
export const ACCESSORIES = new Set([0, 1, 2, 3, 4, 5].map((k) => FIRST_ACCESSORY + k));

/** How far a fighter whose body's and feet's lowest points stand `low` above the floor is lifted onto it (less than 0, lowered). */
export function liftOnto(low: { body: number; feet: number }): number {
  const above = low.feet - low.body;
  if (!(above < NOT_STANDING)) return 0;
  const standing = above <= STANDING ? 1 : (NOT_STANDING - above) / (NOT_STANDING - STANDING);
  const feet = low.feet;
  const lift = feet <= GROUNDED ? Math.min(-feet, MOST_LIFT) : feet >= AIRBORNE ? 0 : (-GROUNDED * (AIRBORNE - feet)) / (AIRBORNE - GROUNDED);
  return standing * lift;
}
