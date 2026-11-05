/**
 * The progress kept on this device, in the engine's store (the browser's storage, or the app's):
 * read as the page starts and written whenever the game saves (`Progress`). A page started with
 * one of its shortcuts (`arcade`, `versus`, `ball`, `ending`, `record`, `unlock`) reads it and never writes it, so a
 * shortcut's run leaves the progress as it was.
 */
import { defaultStore, type KeyValueStore } from '@driftengine/core';
import { expectArray, expectInt, expectObject, expectString } from '../assets/validate.ts';
import { saveRecords } from '../sim/game/records.ts';
import type { Progress, SavedSurvivor, SavedTime } from '../sim/game/save.ts';
import type { GameState } from '../sim/game/state.ts';

/**
 * Where the progress is kept, and the shape it is kept in (the first had none of the options the
 * Options added, and no vibration a player set: it is read as on).
 */
const KEY = 'tekken3.progress';
const FORMAT = 2;
const FIRST_FORMAT = 1;
const VIBRATION_ON = 1;
const WHERE = 'the saved progress';
/** The rows the game keeps: characters' plays (an added one last), best times, survival's records, and each pad's keys. */
const PLAY_ROWS = 23;
const TIMES = 22;
const SURVIVORS = 10;
const PADS = 2;
const KEYS = 8;
/** A record holder's initials: at most four letters. */
const INITIALS = 4;

const byte = (value: unknown, where: string): number => expectInt(value, where, 0, 0xff);
const half = (value: unknown, where: string): number => expectInt(value, where, 0, 0xffff);
const word = (value: unknown, where: string): number => expectInt(value, where, 0, 0xffffffff);
const list = <T>(value: unknown, where: string, length: number, each: (value: unknown, where: string) => T): T[] => expectArray(value, where, length).map((v, i) => each(v, `${where}[${i}]`));

function initials(value: unknown, where: string): string {
  const text = expectString(value, where);
  if (INITIALS < text.length) throw new Error(`${where} is longer than ${INITIALS} letters`);
  return text;
}

function time(value: unknown, where: string): SavedTime {
  const o = expectObject(value, where);
  return { frames: word(o.frames, `${where}.frames`), initials: initials(o.initials, `${where}.initials`) };
}

function survivor(value: unknown, where: string): SavedSurvivor {
  const o = expectObject(value, where);
  return { roster: half(o.roster, `${where}.roster`), wins: half(o.wins, `${where}.wins`), initials: initials(o.initials, `${where}.initials`) };
}

/** A saved progress checked field by field. */
export function parseProgress(json: unknown): Progress {
  const o = expectObject(json, WHERE);
  if (o.format !== FORMAT && o.format !== FIRST_FORMAT) throw new Error(`${WHERE} is format ${String(o.format)}, not ${FORMAT}`);
  const r = expectObject(o.records, `${WHERE}.records`);
  const at = (key: string): string => `${WHERE}.records.${key}`;
  const p = expectObject(o.options, `${WHERE}.options`);
  const option = (key: string): string => `${WHERE}.options.${key}`;
  const earned = expectObject(o.earned, `${WHERE}.earned`);
  const attract = expectObject(o.attract, `${WHERE}.attract`);
  return {
    records: {
      earnedRoster: word(r.earnedRoster, at('earnedRoster')),
      extraCostumes: word(r.extraCostumes, at('extraCostumes')),
      extraDrawn: byte(r.extraDrawn, at('extraDrawn')),
      plays: list(r.plays, at('plays'), PLAY_ROWS, (row, where) => list(row, where, 4, half)),
      endings: list(r.endings, at('endings'), 2, word),
      times: list(r.times, at('times'), TIMES, time),
      survivors: list(r.survivors, at('survivors'), SURVIVORS, survivor),
      newest: byte(r.newest, at('newest')),
      demoTurn: byte(r.demoTurn, at('demoTurn')),
      playsSince: half(r.playsSince, at('playsSince')),
      scheduleStep: byte(r.scheduleStep, at('scheduleStep')),
      scheduleStarted: byte(r.scheduleStarted, at('scheduleStarted')),
      forceBest: r.forceBest === undefined ? 0 : word(r.forceBest, at('forceBest')),
      forceKeys: r.forceKeys === undefined ? 0 : byte(r.forceKeys, at('forceKeys')),
    },
    options: {
      difficulty: byte(p.difficulty, option('difficulty')),
      rounds: byte(p.rounds, option('rounds')),
      roundTime: byte(p.roundTime, option('roundTime')),
      alwaysChip: byte(p.alwaysChip, option('alwaysChip')),
      continueChooses: byte(p.continueChooses, option('continueChooses')),
      vibration: o.format === FIRST_FORMAT ? [VIBRATION_ON, VIBRATION_ON] : list(p.vibration, option('vibration'), PADS, byte),
      lastChoices: list(p.lastChoices, option('lastChoices'), PADS, byte),
      keepChoices: byte(p.keepChoices, option('keepChoices')),
      modeSetting: byte(p.modeSetting, option('modeSetting')),
      keys: list(p.keys, option('keys'), PADS, (keys, where) => list(keys, where, KEYS, byte)),
      ...(o.format === FIRST_FORMAT
        ? {}
        : {
            musicSet: expectInt(p.musicSet, option('musicSet'), 0, 2),
            stereo: expectInt(p.stereo, option('stereo'), 0, 1),
            otherTitle: expectInt(p.otherTitle, option('otherTitle'), 0, 1),
            autoSave: expectInt(p.autoSave, option('autoSave'), 0, 1),
            display: (() => {
              const d = expectObject(p.display, option('display'));
              return { x: expectInt(d.x, option('display.x'), -6, 14), y: expectInt(d.y, option('display.y'), 0, 8) };
            })(),
          }),
    },
    earned: { ball: byte(earned.ball, `${WHERE}.earned.ball`), theater: byte(earned.theater, `${WHERE}.earned.theater`) },
    attract: { intros: byte(attract.intros, `${WHERE}.attract.intros`), intro: byte(attract.intro, `${WHERE}.attract.intro`) },
  };
}

/** The progress kept in `store`, or null when there is none or it cannot be read (the game then starts afresh). */
export function readProgress(store: KeyValueStore = defaultStore()): Progress | null {
  const text = store.read(KEY);
  if (text === null) return null;
  try {
    return parseProgress(JSON.parse(text));
  } catch (error) {
    console.warn(`[tekken3 remake] ${WHERE} is not read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The progress kept in `store`, in place of what was. */
export function writeProgress(progress: Progress, store: KeyValueStore = defaultStore()): void {
  store.write(KEY, JSON.stringify({ format: FORMAT, ...progress }));
}

/**
 * With auto save on, the records saved as soon as the game moves on (a scene, or a step of one)
 * after they change: a match's result, an ending, a record. The console saves only on the way to
 * the title and before the records, so a game closed after a fight would lose it.
 */
export class SaveAsItGoes {
  private scene = -1;
  private step = -1;

  /** After a field: the records saved (`saveRecords`) if the game moved on. */
  field(game: GameState): void {
    if (game.scene === this.scene && game.step === this.step) return;
    this.scene = game.scene;
    this.step = game.step;
    saveRecords(game);
  }
}
