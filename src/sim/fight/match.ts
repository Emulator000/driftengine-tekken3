/**
 * A match: the fight data its two movesets make (each fighter's move ids bound, an id a side lacks
 * taking the other side's move or else the side's default), and its start: both fighters placed on
 * the roster with their models' facts, the rounds a win takes, each side's bank of voices, the win
 * streak shown, full health for the mode, and the stage's ground and scenery.
 */
import type { LoadedMoveset, FightData, FightState, Fighter, MoveRef } from './state.ts';
import { Mode } from './state.ts';
import { restHands } from './hands.ts';
import { FIRST_ACCESSORY } from './accessories.ts';
import type { OwnAccessory } from '../data/models.ts';
import { s16 } from '../math/integers.ts';
import { keyOffVoices, reverbOff } from './voices.ts';

/** One side of a match: who plays, in what costume, and whether the computer does. */
export interface Entrant {
  readonly roster: number;
  readonly costume: number;
  readonly computer: boolean;
}

export interface MatchSetup {
  readonly stage: number;
  readonly entrants: readonly [Entrant, Entrant];
  /** With Mokujin in it, the characters he draws a moveset from each round (roster bits). */
  readonly draws?: number;
  /** A Tekken Force stage's: its second enemy (the third fighter) and its boss (none on the final stage). */
  readonly force?: { readonly third: Entrant; readonly boss: Entrant | null };
}

/** Mokujin's roster id; the characters he may draw from of those earned (the first fourteen and Gun Jack). */
export const MOKUJIN = 0xf;
export const MOKUJIN_DRAWS = 0x13fff;

/** The tables a fight reads whatever the match: everything in the fight data but its movesets. */
export type FightTables = Omit<FightData, 'sets' | 'moveIds'>;

const ROSTER_CODES = 0x5c;
const FALLBACK_CODE = 0x58;
const TRUE_OGRE = 0x14;
/** Moveset ids past Tekken Ball's soldiers are theirs. */
const LAST_MOVESET = 0x14;
const MOVE_IDS = 4023;
/** The move a character's missing ids fall back to when the other side lacks them too. */
const DEFAULT_MOVE = 0xdc5;
const MOST_ROUNDS = 5;
const NO_VOICE = 0x16;
const NO_BANK = 0xff;
/** The first of the two VABs the fighters' banks are opened in. */
const FIGHTER_VAB = 2;
const ARCADE = 0;
const VERSUS = 1;
const ATTRACT = 6;
/** Full health by mode: the arcade's (one human or two), the attract's, survival's, team battle's, practice's, the rest's. */
const Health = { ARCADE_ONE: 8, ARCADE_TWO: 3, ATTRACT: 2, SURVIVAL: 3, TEAM_BATTLE: 5, PRACTICE: 7, OTHER: 8 } as const;
const STREAK_MOST = 999;
/** Tekken Force's final stage, where the second enemy stands by unplaced. */
const FORCE_FINAL_STAGE = 4;
/** Stages whose ground fades from the fighters at once, by the stage. */
export const groundFadeOf = (stage: number): number => (stage < 1 || (2 < stage && stage !== 7) ? 10000 : 0x1964);

/** A roster code's record: past the table, the game reads the fallback's. */
function codeOf(tables: FightTables, roster: number, costume: number): { code: number; sound: number; moveset: number; pack: number } {
  const code = roster * 4 + (costume & 3);
  if (code === ROSTER_CODES) throw new Error(`roster code ${code} reads past the roster's records`);
  const entry = tables.roster.codes[ROSTER_CODES < code ? FALLBACK_CODE : code]!;
  return { code, sound: entry.sound, moveset: Math.min(entry.moveset, LAST_MOVESET), pack: code < ROSTER_CODES ? entry.pack : -1 };
}

/** The movesets a match loads: each side's, the second none (-1) when both play the same. */
export function matchMovesets(tables: FightTables, setup: MatchSetup): [number, number] {
  const [a, b] = setup.entrants.map((e) => codeOf(tables, e.roster, e.costume).moveset) as [number, number];
  return [a, b === a ? -1 : b];
}

/** A Tekken Force stage's boss's moveset (-1 none). */
export function bossMoveset(tables: FightTables, setup: MatchSetup): number {
  const boss = setup.force?.boss ?? null;
  return boss === null ? -1 : codeOf(tables, boss.roster, boss.costume).moveset;
}

/** Each fighter's move ids bound to moves: its own moveset's table, the common moveset's shared moves, missing ids shared across. */
export function bindMoveIds(sets: readonly [LoadedMoveset | null, LoadedMoveset | null, LoadedMoveset]): [(MoveRef | null)[], (MoveRef | null)[]] {
  const slotOf = (side: number): number => (side === 1 && sets[1] !== null ? 1 : 0);
  const tables = [0, 1].map((side) => {
    const slot = slotOf(side);
    const moveset = sets[slot]!.moveset;
    return moveset.moveIds.map((ref): MoveRef | null => (ref === null ? null : { set: ref.common ? 2 : slot, index: ref.index }));
  }) as [(MoveRef | null)[], (MoveRef | null)[]];
  if (slotOf(1) === 0) tables[1] = tables[0];
  const missing = [0, 1].map((side) => new Set(sets[slotOf(side)]!.moveset.missing));
  const defaults = [tables[0][DEFAULT_MOVE] ?? null, tables[1][DEFAULT_MOVE] ?? null];
  for (let id = 0; id < MOVE_IDS; id += 1) {
    const lackA = missing[0]!.has(id);
    const lackB = missing[1]!.has(id);
    if (lackA) tables[0][id] = lackB ? defaults[0]! : tables[1][id]!;
    if (lackB) tables[1][id] = lackA ? defaults[1]! : tables[0][id]!;
  }
  return slotOf(1) === 0 ? [tables[0], [...tables[0]]] : tables;
}

/** The movesets of the characters Mokujin draws from (each roster's first costume's). */
export function drawnMovesets(tables: FightTables, draws: number): number[] {
  const ids = new Set<number>();
  for (let roster = 0; roster < 0x16; roster += 1) if ((draws & (1 << roster)) !== 0) ids.add(codeOf(tables, roster, 0).moveset);
  return [...ids];
}

/** The fight data of a match: the tables, its two movesets (one when both share) and the common one, the move ids bound; with Mokujin, the movesets he may draw. */
export function fightDataFor(tables: FightTables, setup: MatchSetup, moveset: (id: number) => LoadedMoveset, common: LoadedMoveset): FightData {
  const [a, b] = matchMovesets(tables, setup);
  const sets: [LoadedMoveset | null, LoadedMoveset | null, LoadedMoveset] = [moveset(a), b < 0 ? null : moveset(b), common];
  const draws = setup.draws ?? 0;
  const boss = bossMoveset(tables, setup);
  const force = setup.force === undefined ? {} : { forceSets: { enemies: sets[1] ?? sets[0]!, boss: boss < 0 ? null : moveset(boss) } };
  if (draws === 0) return { ...tables, sets, moveIds: bindMoveIds(sets), ...force };
  const movesets = new Map(drawnMovesets(tables, draws).map((id) => [id, moveset(id)] as const));
  const own: [LoadedMoveset, LoadedMoveset] = [sets[0]!, sets[1] ?? sets[0]!];
  return { ...tables, sets, moveIds: bindMoveIds(sets), mokujin: { draws, movesets, own }, ...force };
}

/**
 * Mokujin's moveset for a round: one of the characters he draws from, at random (Paul's with none),
 * then both sides' movesets bound again for the round.
 */
export function drawMokujin(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const mokujin = data.mokujin;
  if (mokujin === undefined) throw new Error("Mokujin's match has no movesets to draw from");
  for (const f of [a, b]) {
    if (f.roster !== MOKUJIN) continue;
    const rosters: number[] = [];
    for (let roster = 0; roster < 0x16; roster += 1) if ((mokujin.draws & (1 << roster)) !== 0) rosters.push(roster);
    state.noise = (Math.imul(state.noise, 5) + 1) >>> 0;
    const roster = rosters.length === 0 ? 0 : rosters[(state.noise & 0xfff) % rosters.length]!;
    f.character = codeOf(data, roster, 0).moveset;
  }
  const set = (f: Fighter, side: number): LoadedMoveset => {
    if (f.roster !== MOKUJIN) return mokujin.own[side]!;
    const found = mokujin.movesets.get(f.character);
    if (found === undefined) throw new Error(`Mokujin drew moveset ${f.character}, which is not loaded`);
    return found;
  };
  data.sets = [set(a, 0), b.character === a.character ? null : set(b, 1), data.sets[2]];
  data.moveIds = bindMoveIds(data.sets);
}

/** A fighter on the roster: its roster id and code, its moveset, sound character and model pack. */
export function placeOnRoster(tables: FightTables, f: Fighter, entrant: Entrant): void {
  const { code, sound, moveset, pack } = codeOf(tables, entrant.roster, entrant.costume);
  f.roster = entrant.roster;
  f.rosterCode = code;
  f.character = moveset;
  f.sound = sound;
  f.costume = pack;
}

/** Each side's bank of voices: kept where VAB 2 or 3 already holds it, else loaded into the one the other side leaves (both when both load). */
export function chooseFighterBanks(state: FightState, data: FightTables): void {
  const sound = state.sound;
  reverbOff(state);
  const wanted = [0, 1].map((side) => data.sound.banks[state.fighters[side]!.sound] ?? NO_BANK);
  let missing = 0;
  for (let side = 0; side < 2; side += 1) {
    if (sound.vabs[FIGHTER_VAB] === wanted[side]) sound.fighterBanks[side] = FIGHTER_VAB;
    else if (sound.vabs[FIGHTER_VAB + 1] === wanted[side]) sound.fighterBanks[side] = FIGHTER_VAB + 1;
    else missing |= 1 << side;
  }
  /* A bank loaded into its VAB, unless the side has no voice; the attract's intro loads none (0xff). */
  const load = (side: number, vab: number): void => {
    if (state.fighters[side]!.sound === NO_VOICE) return;
    sound.vabs[vab] = state.attractIntro !== 0 ? NO_BANK : wanted[side]!;
    if (vab === FIGHTER_VAB) sound.theater = 0;
  };
  if (missing === 1 || missing === 2) {
    const side = missing - 1;
    const free = (sound.fighterBanks[1 - side]! + 1) & 1;
    sound.fighterBanks[side] = free + FIGHTER_VAB;
    load(side, free + FIGHTER_VAB);
  } else if (missing === 3) {
    sound.fighterBanks[0] = FIGHTER_VAB;
    sound.fighterBanks[1] = wanted[0] === wanted[1] ? FIGHTER_VAB : FIGHTER_VAB + 1;
    load(0, FIGHTER_VAB);
    if (wanted[0] !== wanted[1]) load(1, FIGHTER_VAB + 1);
  }
}

/** A fighter's model facts: its size, its parts hung on their joints (each joint's offset from its parent), its accessories at rest; hands, eyes and wings at rest. */
export function setUpModel(state: FightState, data: FightTables, f: Fighter): void {
  const model = data.models[f.costume];
  if (model == null) throw new Error(`model pack ${f.costume} has no model`);
  f.size = model.size;
  f.currentSize = model.size;
  const skeleton = data.skeleton;
  /* A model with its own accessories takes the tables' parts up to the accessories. */
  const own = model.accessories;
  const tableParts = own === undefined ? 22 : FIRST_ACCESSORY;
  for (let part = tableParts; part < f.parts.length; part += 1) {
    f.parts[part]!.drawn = 0;
    f.parts[part]!.hung = 0;
  }
  if (own !== undefined) hangOwn(f, own);
  for (let part = 0; part < tableParts; part += 1) {
    const joint = skeleton.partJoints[part]!;
    const record = model.records[skeleton.partRecords[part]!]!;
    const accessory = part - 0x12;
    let drawn = skeleton.partDrawn[part]!;
    if (0 <= accessory && skeleton.accessoriesDrawn[f.costume]![accessory] === 0) drawn = 0;
    f.parts[part]!.drawn = drawn;
    f.parts[part]!.hung = 1;
    let hang = true;
    let parent: number;
    if (record.parent < 0) {
      if (0 <= accessory && record.parent === -1) {
        f.parts[part]!.hung = 0;
        hang = false;
      }
      parent = -1;
    } else parent = f.parts[record.parent]!.hung !== 0 ? skeleton.partJoints[record.parent]! : -1;
    if (hang) f.skeleton.joints[joint]!.parent = parent;
    const local = f.skeleton.locals[joint]!.translation;
    for (let i = 0; i < 3; i += 1) local[i] = record.offset[i]!;
    if (0 <= accessory) {
      const rest = f.accessoryRest[accessory]!;
      for (let i = 0; i < 3; i += 1) rest[i] = (record.rest[i]! << 16) >> 16;
      f.accessoryHung[accessory] = 0;
    }
  }
  f.trueOgre.wingFrame = 0;
  f.wingsOut = 0;
  f.blinkWait = 0;
  f.eyesShut = 0;
  /* A model loaded draws its hands (and True Ogre's wings) as they are in its file. */
  f.hands.drawn.fill(0);
  f.trueOgre.wingDrawn = 0;
  restHands(state, data, f);
}

/**
 * A model's own accessories, each on its own joint and part (18 on): hung on its parent joint at its
 * offset, drawn where it is shown, at rest until it swings, its tip not yet followed.
 */
function hangOwn(f: Fighter, own: readonly (OwnAccessory | null)[]): void {
  own.forEach((accessory, k) => {
    if (accessory === null) return;
    const joint = FIRST_ACCESSORY + k;
    f.parts[joint]!.drawn = accessory.shown ? 1 : 0;
    f.parts[joint]!.hung = 1;
    f.skeleton.joints[joint]!.parent = accessory.parent;
    const local = f.skeleton.locals[joint]!.translation;
    for (let i = 0; i < 3; i += 1) local[i] = accessory.offset[i]!;
    for (let i = 0; i < 3; i += 1) f.accessoryRest[k]![i] = s16(accessory.rest[i]!);
    f.accessoryHung[k] = 0;
    f.accessoryTips[k]!.fill(0);
  });
}

/** The hips' joint and part. */
const HIPS = 11;

/**
 * The joints of the accessories a model hangs from the hips: a model's own accessories whose parent
 * is the hips, or the parts the tables hang on the hips' part by its records, where they are drawn.
 */
export function hungFromHips(data: Pick<FightTables, 'skeleton' | 'models'>, pack: number): number[] {
  const model = data.models[pack];
  if (model == null) return [];
  const own = model.accessories;
  if (own !== undefined) return own.flatMap((accessory, k) => (accessory !== null && accessory.parent === HIPS ? [FIRST_ACCESSORY + k] : []));
  const skeleton = data.skeleton;
  const tails: number[] = [];
  for (let part = FIRST_ACCESSORY; part < skeleton.partJoints.length; part += 1) {
    const parent = model.records[skeleton.partRecords[part]!]?.parent ?? -1;
    if (parent >= 0 && skeleton.partJoints[parent] === HIPS && skeleton.accessoriesDrawn[pack]?.[part - FIRST_ACCESSORY] !== 0) tails.push(skeleton.partJoints[part]!);
  }
  return tails;
}

/** A fighter's full health for the mode. */
export function setMaxHealth(state: FightState, data: FightTables, f: Fighter): void {
  const health = data.roster.health;
  let max: number;
  if (state.mode === ARCADE) max = health[state.match.humanCount !== 2 ? Health.ARCADE_ONE : Health.ARCADE_TWO]!;
  else if (state.mode === VERSUS) max = health[state.options.handicaps[f.movesetSlot]!]!;
  else if (state.mode === Mode.TEAM_BATTLE) max = health[Health.TEAM_BATTLE]!;
  else if (state.mode === Mode.SURVIVAL) max = health[Health.SURVIVAL]!;
  else if (state.mode === Mode.PRACTICE) max = health[Health.PRACTICE]!;
  else if (state.mode === ATTRACT) max = health[Health.ATTRACT]!;
  else if (state.mode === Mode.TEKKEN_FORCE && f.computer !== 0) max = 0;
  else max = health[Health.OTHER]!;
  f.maxHealth = max;
}

/** A match starts: the fighters placed and loaded, the rounds a win takes, the streak, full health, the stage's ground and scenery. */
export function startMatch(state: FightState, data: FightTables, setup: MatchSetup): void {
  const [a, b] = state.fighters;
  state.round.number = 0;
  state.stage = setup.stage;
  const rounds = Math.min(state.options.rounds + 1, MOST_ROUNDS);
  state.match.roundsToWin = rounds;
  state.round.last = rounds * 2 - 1;
  placeOnRoster(data, a, setup.entrants[0]);
  placeOnRoster(data, b, setup.entrants[1]);
  state.match.trueOgres = (a.roster === TRUE_OGRE ? 1 : 0) | (b.roster === TRUE_OGRE ? 2 : 0);
  a.computer = setup.entrants[0].computer ? 1 : 0;
  b.computer = setup.entrants[1].computer ? 1 : 0;
  keyOffVoices(state, true);
  chooseFighterBanks(state, data);
  setUpModel(state, data, a);
  setUpModel(state, data, b);
  const wins = state.match.streak;
  state.hud.streakSide = wins === 0 ? 0 : state.match.streakSide;
  state.hud.streak = Math.min(wins, STREAK_MOST);
  setMaxHealth(state, data, a);
  setMaxHealth(state, data, b);
  if (state.mode === Mode.TEKKEN_BALL) setMaxHealth(state, data, state.fighters[2]!);
  a.wins = 0;
  b.wins = 0;
  /* Tekken Force's second enemy, its model set up where a stage places it (not the final stage). */
  const force = setup.force;
  if (force !== undefined) {
    const c = state.fighters[2];
    placeOnRoster(data, c, force.third);
    c.computer = 1;
    c.wins = 0;
    if (state.match.stage < FORCE_FINAL_STAGE) setUpModel(state, data, c);
  }
  state.groundFade = groundFadeOf(setup.stage);
  state.scenery.yaw = 0;
  state.scenery.yawBefore = state.camera.drawn.yaw & 0xfff;
  state.scenery.lastYaw = state.scenery.yawBefore;
  state.replay.first = 0;
}

/** The quick match's start, as the game sets it up: no match winner or result yet. */
export function startQuickMatch(state: FightState, data: FightTables, setup: MatchSetup): void {
  state.match.winner = 0;
  state.round.result = 0;
  startMatch(state, data, setup);
}
