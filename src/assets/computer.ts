/** The computer player's tables (`tables/computer.json`), validated. */
import type { CharacterAnswer, ComputerTables, Responses } from '../sim/data/computer.ts';
import { AssetError, expectArray, expectInt, expectInts, expectObject } from './validate.ts';

const ANSWERS: readonly CharacterAnswer[] = ['none', 'against 0', 'against 4', 'against 14', 'against 19', 'own 3', 'own 6'];
const halves = (value: unknown, where: string, length?: number): number[] => [...expectInts(value, where, length, (n) => new Int16Array(n), -0x8000, 0x7fff)];
const unsigned = (value: unknown, where: string, length: number): number[] => [...expectInts(value, where, length, (n) => new Uint16Array(n), 0, 0xffff)];
const words = (value: unknown, where: string, length: number): number[] => expectArray(value, where, length).map((v, i) => expectInt(v, `${where}[${i}]`, 0, 0xffffffff));

function answer(value: unknown, where: string): CharacterAnswer {
  if (!ANSWERS.includes(value as CharacterAnswer)) throw new AssetError(where, `is ${String(value)}, not an answer routine`);
  return value as CharacterAnswer;
}

export function parseComputerTables(json: unknown, where = 'tables/computer.json'): ComputerTables {
  const o = expectObject(json, where);
  const steps = expectInts(o.steps, `${where} steps`, undefined, (n) => new Int16Array(n), -0x8000, 0x7fff);
  const script = (value: unknown, at: string, none = false): number => expectInt(value, at, none ? -1 : 0, steps.length - 1);
  const sequenceSteps = expectInts(o.sequenceSteps, `${where} sequenceSteps`, undefined, (n) => new Int16Array(n), -0x8000, 0x7fff);
  const sequence = (value: unknown, at: string): number => expectInt(value, at, -1, sequenceSteps.length - 1);
  const sequences = expectObject(o.sequences, `${where} sequences`);
  return {
    tuning: expectArray(o.tuning, `${where} tuning`, 3).map((level, l) => expectArray(level, `${where} tuning[${l}]`, 10).map((v, s) => halves(v, `${where} tuning[${l}][${s}]`, 55))),
    characters: expectArray(o.characters, `${where} characters`).map((v, i) => halves(v, `${where} characters[${i}]`, 6)),
    steps,
    sidesteps: expectArray(o.sidesteps, `${where} sidesteps`, 2).map((v, i) => script(v, `${where} sidesteps[${i}]`)),
    backAway: script(o.backAway, `${where} backAway`),
    approach: script(o.approach, `${where} approach`),
    responses: expectArray(o.responses, `${where} responses`).map((v, i): Responses => {
      const at = `${where} responses[${i}]`;
      const r = expectObject(v, at);
      return {
        flag: expectInt(r.flag, `${at}.flag`, -0x8000, 0x7fff),
        answer: script(r.answer, `${at}.answer`, true),
        lowAnswer: script(r.lowAnswer, `${at}.lowAnswer`, true),
        openers: expectArray(r.openers, `${at}.openers`).map((e, k) => {
          const oat = `${at}.openers[${k}]`;
          const opener = expectObject(e, oat);
          return { odds: expectInt(opener.odds, `${oat}.odds`, 0, 0x7fff), moveId: expectInt(opener.moveId, `${oat}.moveId`, -0x8000, 0x7fff), script: script(opener.script, `${oat}.script`) };
        }),
      };
    }),
    kingScripts: expectArray(o.kingScripts, `${where} kingScripts`, 7).map((v, i) => script(v, `${where} kingScripts[${i}]`)),
    sequenceSteps,
    sequences: {
      dashForward: sequence(sequences.dashForward, `${where} sequences.dashForward`),
      dashBack: sequence(sequences.dashBack, `${where} sequences.dashBack`),
      a: expectArray(sequences.a, `${where} sequences.a`, 0x3f).map((v, i) => sequence(v, `${where} sequences.a[${i}]`)),
      b: expectArray(sequences.b, `${where} sequences.b`, 0x29).map((v, i) => sequence(v, `${where} sequences.b[${i}]`)),
    },
    stepPads: unsigned(o.stepPads, `${where} stepPads`, 16),
    commandMasks: unsigned(o.commandMasks, `${where} commandMasks`, 10),
    commandPads: unsigned(o.commandPads, `${where} commandPads`, 10),
    buttonPads: unsigned(o.buttonPads, `${where} buttonPads`, 4),
    dodgePads: unsigned(o.dodgePads, `${where} dodgePads`, 4),
    downedActions: unsigned(o.downedActions, `${where} downedActions`, 6),
    retreatPlans: expectArray(o.retreatPlans, `${where} retreatPlans`, 7).map((v, i) => expectInt(v, `${where} retreatPlans[${i}]`, 0, 0xff)),
    followUpKinds: words(o.followUpKinds, `${where} followUpKinds`, 6),
    walkStopKinds: words(o.walkStopKinds, `${where} walkStopKinds`, 6),
    answers: expectArray(o.answers, `${where} answers`, 10).map((v, i) => {
      const at = `${where} answers[${i}]`;
      const a = expectObject(v, at);
      return { moveset: expectInt(a.moveset, `${at}.moveset`, 0, 0xffff), against: answer(a.against, `${at}.against`), own: answer(a.own, `${at}.own`) };
    }),
    forcePacing: expectArray(o.forcePacing, `${where} forcePacing`, 3).map((level, l) =>
      expectArray(level, `${where} forcePacing[${l}]`, 5).map((entry, i) => {
        const [wait, hold, hangBack] = expectArray(entry, `${where} forcePacing[${l}][${i}]`, 3).map((v, k) => expectInt(v, `${where} forcePacing[${l}][${i}][${k}]`, -0x8000, 0x7fff));
        return [wait!, hold!, hangBack!] as const;
      }),
    ),
  };
}
