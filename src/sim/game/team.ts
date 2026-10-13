/**
 * Team Battle's run: its teams filled as it starts (the members a player did not choose drawn from
 * the characters drawn least, the first of a human's from the two it has played least) and each
 * bout's two members sent in, the computer's stronger the nearer its team is to its last.
 */
import { settleCostumes } from './arcade.ts';
import { playCount, sortPairs } from './records.ts';
import { stepNoise } from './select.ts';
import type { Team } from '../fight/state.ts';
import type { GameState } from './state.ts';

/** The characters a team may draw: those earned but Mokujin (and Tekken Force's). */
const DRAWN = 0x1f7fff;
const CHARACTERS = 22;
/** No member sent in yet. */
const NONE_SENT = 0xff;
/** The computer's strength over its difficulty: a random part, and more for a team's last two. */
const STRENGTH = { base: 3, random: 3, secondLast: 1, last: 3, most: 9 } as const;

const bit = (roster: number): number => 1 << (roster & 0x1f);

/** Rosters set in `bits`, the lowest first. */
function rostersOf(bits: number): number[] {
  const out: number[] = [];
  for (let roster = 0; roster < CHARACTERS; roster += 1) if ((bits & bit(roster)) !== 0) out.push(roster);
  return out;
}

/** One of `pool` at random, taken out of it (the last put in its place). */
function takeRandom(game: GameState, pool: number[]): number {
  const at = (stepNoise(game) >>> 0) % pool.length;
  const roster = pool[at]!;
  pool[at] = pool[pool.length - 1]!;
  pool.pop();
  return roster;
}

/**
 * A team's members past those its player chose, drawn: on a human's team of three or more the
 * first is one of the two characters it has played least; the rest from those drawn into teams
 * least (more as needed to have enough), at random, in the costume its size's button chose (the
 * other where the other team chose the same); then each member counted as drawn.
 */
function drawMembers(game: GameState, human: boolean, team: Team, other: Team): void {
  const uses = game.run.team.uses;
  let pool = (game.records.earnedRoster & DRAWN) >>> 0;
  for (let k = 0; k < team.chosen; k += 1) pool &= ~bit(team.members[k]! >> 2);
  let first = 0;
  let picked = 0;
  if (human && 2 < team.size) {
    const played: [number, number][] = rostersOf(pool).map((roster) => [roster, playCount(game, roster)]);
    if (played.length !== 0) sortPairs(played, true);
    if (1 < played.length) {
      first = 1;
      picked = bit(played[stepNoise(game) & 1]![0]);
      pool &= ~picked;
    }
  }
  const least: [number, number][] = rostersOf(pool).map((roster) => [roster, uses[roster]!]);
  if (least.length !== 0) sortPairs(least, true);
  const needed = team.size - (team.chosen + first);
  let count = 0;
  for (let spread = 0; count < needed && count < least.length; spread += 1) {
    count = 0;
    while (count < least.length && !(least[0]![1] + spread < least[count]![1])) count += 1;
  }
  const candidates = rostersOf(least.slice(0, count).reduce((bits, [roster]) => bits | bit(roster), 0));
  for (let k = first; k < team.size - team.chosen; k += 1) picked |= bit(takeRandom(game, candidates));
  const members = rostersOf(picked);
  for (let k = team.chosen; k < team.size; k += 1) {
    const roster = takeRandom(game, members);
    let code = roster * 4 + team.kick;
    if (other.members.slice(0, other.chosen).includes(code)) code = roster * 4 + (team.kick ^ 1);
    team.members[k] = code;
  }
  for (let k = 0; k < team.size; k += 1) {
    const roster = team.members[k]! >> 2;
    uses[roster] = (uses[roster]! + 1) & 0xffff;
  }
}

/**
 * Team Battle's run set up: no bout fought, no member sent in; a side no player is on takes the
 * other's size and the other costume; then each side's team filled.
 */
export function teamStart(game: GameState): void {
  const world = game.world;
  const run = game.run;
  world.match.stage = 0;
  run.versusMatches = 0;
  run.team.bout = 0;
  run.team.bouts.fill(0);
  world.match.teams.forEach((team, n) => {
    const other = world.match.teams[(n + 1) & 1]!;
    team.current = NONE_SENT;
    team.next = 0;
    const human = world.joined[n] !== 0;
    if (!human) {
      team.chosen = 0;
      team.size = other.size;
      team.kick = other.kick === 0 ? 1 : 0;
    }
    drawMembers(game, human, team, other);
  });
}

/** A bout's members sent in where a team's has changed (at full health, the two kept apart), and the computer's strength. */
export function teamRound(game: GameState): void {
  const world = game.world;
  const { roster, costume, computer } = game.entrants;
  game.world.match.teams.forEach((team, side) => {
    if (team.next === team.current) return;
    team.current = team.next;
    world.fighters[side]!.health = 0;
    world.fighters[side]!.carriedHealth = 0;
    const code = team.members[team.next]!;
    roster[side] = code >> 2;
    costume[side] = code & 3;
    computer[side] = world.joined[side] === 0 ? 1 : 0;
    settleCostumes(game, side);
    team.members[team.next] = ((roster[side]! << 2) | costume[side]!) & 0xff;
  });
  world.computer.arcadeStage = 0;
  if (world.match.humanCount !== 1) return;
  const team = game.world.match.teams[world.match.computerSide]!;
  let strength = world.computer.difficulty + STRENGTH.base + (world.vsyncSeen & STRENGTH.random);
  if (team.next + 2 === team.size) strength += STRENGTH.secondLast;
  else if (team.next + 1 === team.size) strength += STRENGTH.last;
  world.computer.arcadeStage = Math.min(strength, STRENGTH.most);
}
