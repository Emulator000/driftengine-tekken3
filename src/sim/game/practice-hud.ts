/**
 * Practice's HUD over the fight: the recorder's and COMBO TRAINING's lines, ATTACK DATA (each
 * side's total damage, the combo's hits and damage, the last hit's damage and how it was scaled,
 * COUNTER and CLEAN HIT, and a marker of each clean hit's level where it landed), and COMBO
 * TRAINING's input display (the combo's directions and buttons, those played lit).
 */
import { draw } from './draw.ts';
import { arrowLine } from './practice-menu.ts';
import { MANUAL_REPLAY, PracticeMode, type PracticeData } from './practice.ts';
import { buttonsOf, comboCount, directionOf } from './practice-recorder.ts';
import { print } from './printer.ts';
import type { DamageRecord, GameState } from './state.ts';

const Step = { READY: 1, ARMED: 2, RECORDING: 3, SHOWING: 5 } as const;
/** The lines' place: the session's, the totals', the last hit's, COUNTER's and CLEAN HIT's. */
const LINE = { x: 9, session: 0x17a, sessionArrows: 0x17b, total: 0x36, otherTotal: 0xcf, damage: 0x48, counter: 0x5a, clean: 0x6c } as const;
/** The combo's count and damage. */
const BIG = { hitsX: 0xc, comboX: [0x20, 0x2a], hitsY: 0x88, damageX: 0x16, damageY: 0xa6, wordY: 0xb0, wordX: [0x2a, 0x35, 0x40], minus: 0xd } as const;
/** The markers by a hit's level: HIGH, MID, LOW, the ! of an unblockable; none for a level of 0x800. */
const MARKER_KINDS: Readonly<Record<number, number>> = { 0x412: 0, 0x217: 1, 0x31f: 1, 0x51f: 1, 0x10f: 2, 0x607: 3, 0x706: 3 };
const NO_MARKER = 0x800;
/** The input display: its left, a step across, its line, the most it shows. */
const INPUTS = { x: 0xc, step: 0x17, y: 0x190, most: 15 } as const;
const ENTRIES = 50;

/** `%03d` as the printer writes it: three digits, zero-padded, a negative one a minus and two, a longer one its last three. */
function threeDigits(n: number): string {
  if (n < 0) return `-${String(-n).padStart(2, '0').slice(-2)}`;
  return String(n).padStart(3, '0').slice(-3);
}

/** The combo's count (when given) and its damage, big. */
function bigCombo(game: GameState, data: PracticeData, hits: number, damage: number): void {
  const lines = data.scenes.practice.lines;
  if (hits !== 0) {
    print(game, 1, 6, BIG.hitsX, BIG.hitsY, String(hits));
    print(game, 1, 5, hits < 10 ? BIG.comboX[0] : BIG.comboX[1], BIG.hitsY, lines.comboHits);
  }
  print(game, 1, 6, BIG.damageX, BIG.damageY, String(damage));
  const size = Math.abs(damage);
  const x = (size < 10 ? BIG.wordX[0] : size < 100 ? BIG.wordX[1] : BIG.wordX[2]) + (damage < 0 ? BIG.minus : 0);
  print(game, 0, 7, x, BIG.wordY, lines.comboDamage);
}

/** ATTACK DATA: the totals, the combo, the last hit, COUNTER and CLEAN HIT, and the markers newest first. */
function attackData(game: GameState, data: PracticeData): void {
  const p = game.practice;
  const lines = data.scenes.practice.lines;
  const partnerRecord: DamageRecord = p.records[p.partnerSide]!;
  const humanRecord: DamageRecord = p.records[p.humanSide]!;
  print(game, 0, 1, LINE.otherTotal, LINE.total, lines.totalDamage.replace('%d', String(humanRecord.total)));
  print(game, 0, 1, LINE.x, LINE.total, lines.totalDamage.replace('%d', String(partnerRecord.total)));
  if (2 <= partnerRecord.shownHits && partnerRecord.timer !== 0 && 0 < partnerRecord.comboShown) bigCombo(game, data, partnerRecord.shownHits, partnerRecord.comboShown);
  else if (2 <= partnerRecord.frames) bigCombo(game, data, 0, partnerRecord.comboShown);
  const { dealt, raw } = partnerRecord;
  const share = raw !== 0 && dealt !== 0 ? Math.trunc((dealt * 100) / raw) : 0;
  const text = lines.damage.replace('%03d', threeDigits(dealt)).replace('%03d', threeDigits(share)).replace('%%', '%');
  print(game, 0, raw < dealt ? 7 : dealt === raw ? 6 : 3, LINE.x, LINE.damage, text);
  if (partnerRecord.counter !== 0) print(game, 0, 2, LINE.x, LINE.counter, lines.counter);
  if (partnerRecord.clean !== 0) print(game, 0, 5, LINE.x, LINE.clean, lines.cleanHit);
  for (let i = 0; i < 4; i += 1) {
    let k = p.markerAt - i;
    if (k < 0) k += 4;
    const marker = p.markers[k]!;
    if (marker.timer === 0 || marker.level === NO_MARKER) continue;
    const kind = MARKER_KINDS[marker.level] ?? 0;
    draw(game, { kind: 'marker', marker: kind, x: marker.x, y: marker.y, layer: kind === 3 ? 2 : 1 });
  }
}

/** The input display's icons' kinds: directions played and to come, button sets played and to come (0 lit, 3 dim; 1 and 0 for the buttons' base). */
function looks(look: number, wait: number): readonly [number, number, number, number] {
  if (look === 2 || (look === 3 && (wait & 0x10) !== 0)) return [3, 3, 0, 0];
  if (look === 4 || look === 5) return [0, 3, 1, 0];
  return [0, 0, 1, 1];
}

/** COMBO TRAINING's input display: the recording's directions and new buttons, oldest first, the last fifteen at most. */
function inputDisplay(game: GameState): void {
  const p = game.practice;
  const r = p.recorder;
  const [dirPlayed, dirToCome, buttonsPlayed, buttonsToCome] = looks(p.look, p.lookWait);
  const icons: { pad: number; kind: number }[] = [];
  let sinceZero = 0;
  let lastDirection = 0;
  let lastButtons = 0;
  const last = r.last[p.player]!;
  for (let n = 1; n <= ENTRIES; n += 1) {
    const at = (last + n) % ENTRIES;
    if (at === 0) sinceZero = 0;
    const entry = r.entries[at]!;
    const played = at <= r.playIndex;
    const direction = directionOf(entry);
    const buttons = buttonsOf(entry);
    if (direction !== 0 && direction !== lastDirection) {
      icons.push({ pad: direction << 12, kind: played ? dirPlayed : dirToCome });
      sinceZero += 1;
    }
    const fresh = buttons & (buttons ^ lastButtons);
    if (fresh !== 0) {
      icons.push({ pad: fresh << 4, kind: played ? buttonsPlayed : buttonsToCome });
      sinceZero += 1;
    }
    lastDirection = direction;
    lastButtons = buttons;
  }
  const shown = p.guide !== 0 ? Math.min(icons.length, sinceZero, INPUTS.most) : Math.min(icons.length, INPUTS.most);
  icons.slice(icons.length - shown).forEach((icon, i) => draw(game, { kind: 'input', pad: icon.pad, lit: icon.kind, x: INPUTS.x + i * INPUTS.step, y: INPUTS.y, layer: 3 }));
}

/** Practice's HUD this frame (nothing while it starts or nothing is drawn). */
export function practiceHud(game: GameState, data: PracticeData): void {
  const p = game.practice;
  const world = game.world;
  if (world.practice.starting !== 0 || world.nothingDrawn !== 0) return;
  const tables = data.scenes.practice;
  const lines = tables.lines;
  if (p.session !== 0 && !(p.mode === PracticeMode.COMBO && comboCount(tables, world.fighters[p.player]!.character) === 0)) {
    if (p.step === Step.READY) {
      if (p.mode === PracticeMode.COMBO) print(game, 0, 1, LINE.x, LINE.session, lines.playSelect);
      else {
        arrowLine(game, tables.arrows[2]!, LINE.x, LINE.sessionArrows, 7);
        print(game, 0, 5, LINE.x, LINE.session, lines.playMark);
      }
    } else if (p.step === Step.ARMED) print(game, 0, 1, LINE.x, LINE.session, lines.startRecord);
    else if (p.step === Step.RECORDING) print(game, 0, 2, LINE.x, LINE.session, lines.recording);
    else if (p.step === Step.SHOWING) print(game, 0, 5, LINE.x, LINE.session, lines.playing);
  } else if (p.paused === 0 && p.comboReplay === MANUAL_REPLAY && p.mode === PracticeMode.FREESTYLE) print(game, 0, 1, LINE.x, LINE.session, lines.replaySelect);
  if (p.attackData !== 0 && p.paused === 0) attackData(game, data);
  if (p.inputShown !== 0 && p.session !== 0 && p.mode !== PracticeMode.FREESTYLE) inputDisplay(game);
}
