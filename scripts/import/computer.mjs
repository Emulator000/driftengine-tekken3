/**
 * The computer player's tables, from the executable.
 *
 * Tuning: per difficulty (three) and arcade stage (ten), 110 bytes from 0x800231ac (0x44c a
 * difficulty, 0x6e a stage), read as 55 halfwords (the first four bytes also one at a time); per
 * roster row, twelve bytes from 0x80098260 read as six halfwords (bands of distance and how far
 * the character reaches).
 *
 * Input scripts: lists of 16-bit steps (a direction in the low four bits, the attack buttons in
 * bits 8 to 11) that end where a 0 follows, played a step a frame. A script may be entered part way
 * along, so the steps are imported as they lie, one run of halfwords from the first script to the
 * last (0x80022c2a to 0x80023106), and each script by where it starts in that run: the two
 * sidesteps (0x8002306e, 24 bytes apart), backing away (0x80022c46), the approach (0x80022c2a), a
 * moveset's two scripted answers and its openers (sixteen bytes per moveset from 0x80022d14: a flag,
 * the scripts answering an attack and a low one, and a list of openers, eight bytes each: odds, the move id it needs, the
 * script, entered one step in; the list ends at negative odds) and King's (moveset 3) seven, 14
 * bytes apart from 0x800230a6. The input sequences cancel commands name are played as scripts too:
 * their halfwords (0x8001006c to 0x80010738) as one run, each sequence by where it starts (the two
 * dashes, and the two tables of sequences, 0x800954d0 and 0x800955cc).
 *
 * Pads: a script step's direction as pad bits (0x8002301c, sixteen), a command's nine directions as
 * masks of its bits (0x8002303c) and as pad bits (0x80023050), its four buttons as pad bits
 * (0x80023064), and four pads one answer picks from (0x8002309c).
 *
 * Choices: the six things a downed fighter may do as mask bits (0x80022e74), the retreat plans to
 * draw from (0x80022e80, every other byte), per distance band the guard kinds a follow-up may be
 * (0x80098230) and that stop a walk (0x80098248), and per moveset its own answer and the answer to
 * it (0x80023134, twelve bytes: the moveset, then two routines, named here by what they answer).
 *
 * Tekken Force's pacing: per difficulty (three), five entries of three halfwords (0x80022fa4, 0x1e a
 * difficulty): how long an enemy waits after the other's attack, how long it holds still, and the
 * odds (of 4096) it hangs back.
 */
const TUNING = 0x800231ac;
const CHARACTER_TUNING = 0x80098260;
const ROWS = 22;
const SCRIPTS = 0x80022c2a;
const SCRIPTS_END = 0x80023106;
const SIDESTEPS = 0x8002306e;
const BACK_AWAY = 0x80022c46;
const APPROACH = 0x80022c2a;
const RESPONSES = 0x80022d14;
const KING_SCRIPTS = 0x800230a6;
const SEQUENCES = 0x8001006c;
const SEQUENCES_END = 0x80010738;
const DASH_FORWARD = 0x8001006c;
const DASH_BACK = 0x80010078;
const SEQUENCES_A = 0x800954d0;
const SEQUENCES_B = 0x800955cc;
const ANSWERS = 0x80023134;
/** The answer routines, by what each answers; the ones that answer nothing do as no routine does. */
const ROUTINES = new Map([
  [0, 'none'],
  [0x800628c4, 'against 0'],
  [0x80061b88, 'against 4'],
  [0x80061ef0, 'against 14'],
  [0x80062940, 'against 19'],
  [0x8006251c, 'own 3'],
  [0x8006299c, 'own 6'],
  [0x80062928, 'none'],
  [0x80062930, 'none'],
  [0x80062938, 'none'],
  [0x80062994, 'none'],
]);

const halves = (exe, at, count) => Array.from({ length: count }, (_, i) => exe.s16(at + i * 2));
const words = (exe, at, count) => Array.from({ length: count }, (_, i) => exe.u32(at + i * 4));

export function computerTables(exe) {
  const scriptAt = (address) => {
    if (address < SCRIPTS || address >= SCRIPTS_END || (address - SCRIPTS) % 2 !== 0) throw new Error(`a computer script at 0x${address.toString(16)} lies outside the scripts`);
    return (address - SCRIPTS) / 2;
  };
  const sequenceAt = (address) => {
    if (address === 0) return -1;
    if (address < SEQUENCES || address >= SEQUENCES_END) throw new Error(`an input sequence at 0x${address.toString(16)} lies outside the sequences`);
    return (address - SEQUENCES) / 2;
  };
  const routine = (address) => {
    const name = ROUTINES.get(address);
    if (name === undefined) throw new Error(`no answer routine at 0x${address.toString(16)}`);
    return name;
  };
  return {
    tuning: Array.from({ length: 3 }, (_, level) => Array.from({ length: 10 }, (_, stage) => halves(exe, TUNING + level * 0x44c + stage * 0x6e, 55))),
    characters: Array.from({ length: ROWS }, (_, row) => halves(exe, CHARACTER_TUNING + row * 0xc, 6)),
    steps: halves(exe, SCRIPTS, (SCRIPTS_END - SCRIPTS) / 2),
    sidesteps: [0, 1].map((which) => scriptAt(SIDESTEPS + which * 0x18)),
    backAway: scriptAt(BACK_AWAY),
    approach: scriptAt(APPROACH),
    responses: Array.from({ length: 21 }, (_, moveset) => {
      const at = RESPONSES + moveset * 0x10;
      const openers = [];
      const list = exe.u32(at + 0xc);
      if (list !== 0) {
        for (let entry = list; exe.s16(entry) >= 0; entry += 8) openers.push({ odds: exe.s16(entry), moveId: exe.s16(entry + 2), script: scriptAt(exe.u32(entry + 4) + 2) });
      }
      const script = (address) => (address === 0 ? -1 : scriptAt(address));
      return { flag: exe.s16(at), answer: script(exe.u32(at + 4)), lowAnswer: script(exe.u32(at + 8)), openers };
    }),
    kingScripts: Array.from({ length: 7 }, (_, i) => scriptAt(KING_SCRIPTS + i * 14)),
    sequenceSteps: halves(exe, SEQUENCES, (SEQUENCES_END - SEQUENCES) / 2),
    sequences: {
      dashForward: sequenceAt(DASH_FORWARD),
      dashBack: sequenceAt(DASH_BACK),
      a: words(exe, SEQUENCES_A, 0x3f).map(sequenceAt),
      b: words(exe, SEQUENCES_B, 0x29).map(sequenceAt),
    },
    stepPads: Array.from({ length: 16 }, (_, i) => exe.u16(0x8002301c + i * 2)),
    commandMasks: Array.from({ length: 10 }, (_, i) => exe.u16(0x8002303c + i * 2)),
    commandPads: Array.from({ length: 10 }, (_, i) => exe.u16(0x80023050 + i * 2)),
    buttonPads: Array.from({ length: 4 }, (_, i) => exe.u16(0x80023064 + i * 2)),
    dodgePads: Array.from({ length: 4 }, (_, i) => exe.u16(0x8002309c + i * 2)),
    downedActions: Array.from({ length: 6 }, (_, i) => exe.u16(0x80022e74 + i * 2)),
    retreatPlans: Array.from({ length: 7 }, (_, i) => exe.u8(0x80022e80 + i * 2)),
    followUpKinds: words(exe, 0x80098230, 6),
    walkStopKinds: words(exe, 0x80098248, 6),
    answers: Array.from({ length: 10 }, (_, i) => {
      const at = ANSWERS + i * 0xc;
      return { moveset: exe.u16(at), against: routine(exe.u32(at + 4)), own: routine(exe.u32(at + 8)) };
    }),
    forcePacing: Array.from({ length: 3 }, (_, level) => Array.from({ length: 5 }, (_, i) => [0, 2, 4].map((k) => exe.s16(0x80022fa4 + level * 0x1e + i * 6 + k)))),
  };
}
