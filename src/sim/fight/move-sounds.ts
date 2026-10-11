/**
 * A fighter's sounds each frame of the fight: the lines and effects its move and the frame's hits
 * call for, which the round records for its replay.
 *
 * A line is asked for by kind (bits 12 to 15, 2 to 5) and number among its sound character's lines;
 * an effect line by number among the effects, kind 0 keying its voice off. A move's sounds are up to
 * three halfwords whose kind says when: on a blow landing (1, 7), the fighter's lines on its first
 * frame (2 waiting out the last grunt, 3), at once (4, 5), a sound script started (8), an event (9).
 * A sound script is words of frame, kind and code, played from the frame it started on.
 */
import { s16 } from '../math/integers.ts';
import { nextRandom } from '../math/random.ts';
import { echoLine, replayEcho } from '../effects/pool.ts';
import { endSoundScript } from './move.ts';
import { hitOf, moveAt } from './moves.ts';
import type { FightData, Fighter, FightState } from './state.ts';
import { effect, keyOff, lineOff, voiceLine } from './voices.ts';

/** The replay's state while a round records. */
const RECORDING = 7;
const MOKUJIN = 0xf;

const rand = (state: FightState): number => nextRandom(state.random);

/** The first byte of a move's hit data (0 for a move with none, as its pointer then reads). */
const hitCode = (data: FightData, f: Fighter): number => hitOf(data, f.move!)?.codes[0] ?? 0;

function characterOf(data: FightData, who: number) {
  const character = data.sound.characters[who];
  if (character === undefined) throw new Error(`sound character ${who} is not imported`);
  return character;
}

/** While a round records, a sound for the replay: its kind (1 effect, 2 line, 3 effect line), side and code, in the frame's slot. */
function recordSound(state: FightState, kind: number, side: number, code: number): void {
  const replay = state.replay;
  if (replay.state !== RECORDING) return;
  let at = (replay.recordFrame + replay.soundShift) | 0;
  if (at < 0) at += 0x4b00;
  replay.soundShift = (replay.soundShift + 1) | 0;
  const slot = replay.sounds[at % 300]!;
  slot.kind = kind & 0xff;
  slot.side = side & 0xff;
  slot.code = code & 0xffff;
}

/** A line of kind 4 is not recorded for a fighter mid-throw. */
const unrecorded = (state: FightState, side: number, kind: number): boolean => state.fighters[side]!.throwing !== 0 && kind === 4;

/** A character's line by kind (2 to 5) and number, for a side. A kind-4 line echoes and keys voice 0 off; in a replay every other line echoes the replay's way. */
function line(state: FightState, data: FightData, side: number, who: number, code: number): void {
  const lines = characterOf(data, who).lines;
  const kind = (code & 0xffff) >> 12;
  const k = kind - 2;
  if (3 < k >>> 0 || lines.counts[k]! - 1 < (code & 0xfff)) return;
  let at = code & 0xfff;
  for (let i = 0; i < k; i += 1) at += lines.counts[i]!;
  const played = lines.codes[at]!;
  voiceLine(state, data, side, played, 0);
  if (kind === 4) {
    echoLine(state, side, played);
    keyOff(state, 0);
  } else if (state.replaying !== 0) replayEcho(state, side, played);
}

/** A line played and, unless it is unrecorded, recorded. */
function recordedLine(state: FightState, data: FightData, side: number, who: number, code: number): void {
  if (!unrecorded(state, side, code >> 12)) recordSound(state, 2, side, code);
  line(state, data, side, who, code);
}

/** An effect line by number: kind 0 keys its voice off, any other plays it (echoing the replay's way in a replay). */
function effectLine(state: FightState, data: FightData, side: number, code: number): void {
  const n = code & 0xfff;
  if (n === 0) return;
  const played = data.sound.effects[n];
  if (played === undefined) throw new Error(`effect ${n} is past the effects' table`);
  if (s16(code) >> 12 === 0) lineOff(state, side, played);
  else {
    voiceLine(state, data, side, played, 0);
    if (state.replaying !== 0) replayEcho(state, side, played);
  }
}

function recordedEffectLine(state: FightState, data: FightData, side: number, code: number): void {
  recordSound(state, 3, side, code);
  effectLine(state, data, side, code);
}

/** Sound scripts run while the match is starting, opening, fighting, or on its knockout. */
/** A replay's recorded effect, recorded again for the next replay. */
export function replayEffect(state: FightState, data: FightData, code: number): void {
  recordSound(state, 1, 0, code);
  effect(state, data, code);
}

/** A replay's recorded line, for `side` and its sound character `who`. */
export function replayLine(state: FightState, data: FightData, side: number, who: number, code: number): void {
  recordedLine(state, data, side, who, s16(code));
}

/** A replay's recorded effect line. */
export function replayEffectLine(state: FightState, data: FightData, side: number, code: number): void {
  recordedEffectLine(state, data, side, code);
}

const scriptsRun = (state: FightState): boolean => [0, 1, 2, 5].includes(state.status);

/** A hit on roster 0x10: a sound by the blow's damage and the fighter's own, the heaviest two by turns of the fields seen. */
function hitRoster16(state: FightState, data: FightData, p: Fighter, q: Fighter): void {
  let code = 0x705d;
  if (6 < p.attackDamage && 0xf < q.attackDamage) code = (state.vsyncSeen & 3) === 0 ? 0x7099 : 0x7098;
  recordedEffectLine(state, data, q.movesetSlot, code);
}

/** A hit on Mokujin: one of his five sounds at random. */
function mokujinHit(state: FightState, data: FightData, q: Fighter): void {
  const code = data.sound.mokujinHits[((rand(state) & 0xff) * 5) >> 8]!;
  recordedEffectLine(state, data, q.movesetSlot, code);
}

/** A blow's hit sound by its damage (in four bands) and weight: a heavy blow's (its hit code 0xc on) the band's own, a light one's from its roster's table. */
function hitSound(state: FightState, data: FightData, p: Fighter): void {
  const damage = p.attackDamage;
  const band = damage < 0xd ? 0 : damage < 0x17 ? 1 : damage < 0x21 ? 2 : 3;
  let code = 0x7045 + band;
  if (hitCode(data, p) < 0xc) {
    const roster = p.roster;
    const table = roster === 5 || roster === 7 || roster === 10 || roster === 0x12 ? data.sound.hitSounds : data.sound.otherHitSounds;
    const pick = rand(state);
    code = band === 0 ? table[((pick >> 6) & 2) >> 1]! : table[2 + band * 2]!;
  }
  recordedEffectLine(state, data, p.movesetSlot, code);
}

/** A script's event: 1 the fighter's own event line, ending the opponent's script (if one runs); 0 the move's own sounds quieted this frame; 2 no grunt next frame; 3 one of three sounds for the opponent. */
function scriptEvent(state: FightState, data: FightData, p: Fighter, q: Fighter, event: number): void {
  if (event === 1) {
    if (q.soundScript === -1) return;
    recordedLine(state, data, p.movesetSlot, p.sound, characterOf(data, p.sound).eventLine);
    endSoundScript(q);
  } else if (event === 0) state.sound.quiet[p.movesetSlot] = 1;
  else if (event === 2) state.sound.gruntWaits[p.movesetSlot] = 1;
  else if (event === 3) recordedEffectLine(state, data, q.movesetSlot, data.sound.eventSounds[((rand(state) & 0xff) * 3) >> 8]!);
}

/**
 * A blow of `p`'s touched `q` this frame: unblocked, `q`'s script ends and the move's hit sound
 * plays (the generic ones by the blow), roster 0x10 and Mokujin their own; blocked, the block's by
 * weight.
 */
function landed(state: FightState, data: FightData, p: Fighter, q: Fighter, entry: number, finished: boolean): void {
  if (p.struck === 0 || finished) return;
  const heavy = 0xc <= hitCode(data, p);
  const mokujin = q.roster === MOKUJIN && state.sound.mokujinHits[q.movesetSlot] !== 0;
  if (q.guarded === 0) {
    endSoundScript(q);
    if (q.roster === 0x10) hitRoster16(state, data, p, q);
    else if (mokujin) mokujinHit(state, data, q);
    else if (entry !== 0x7000 && entry !== 0x7041 && entry !== 0x7042 && entry !== 0x7045) recordedEffectLine(state, data, p.movesetSlot, s16(entry));
    else hitSound(state, data, p);
  } else if (mokujin) recordedEffectLine(state, data, q.movesetSlot, heavy ? 0x707a : 0x707b);
  else recordedEffectLine(state, data, q.movesetSlot, heavy ? 0x704e : 0x704d);
}

/** One of a script's words, on the frame it names. */
function scriptWord(state: FightState, data: FightData, p: Fighter, q: Fighter, kind: number, code: number): void {
  const lineKind = ((code >> 12) - 2) >>> 0 < 4;
  if (kind === 1) {
    if (lineKind) recordedLine(state, data, p.movesetSlot, p.sound, s16(code));
    else recordedEffectLine(state, data, p.movesetSlot, s16(code));
  } else if (kind === 0) {
    recordSound(state, 1, 0, s16(code));
    effect(state, data, s16(code));
  } else if (kind === 2) {
    if (lineKind) recordedLine(state, data, q.movesetSlot, q.sound, s16(code));
    else recordedEffectLine(state, data, q.movesetSlot, s16(code));
  } else if (kind === 3) scriptEvent(state, data, p, q, code & 0xfff);
}

/** A side's waits for its next grunt and cry run down. */
function countDown(state: FightState, side: number): void {
  const sound = state.sound;
  if (0 < sound.gruntWaits[side]!) sound.gruntWaits[side] = s16(sound.gruntWaits[side]! - 1);
  if (0 < sound.cryWaits[side]!) sound.cryWaits[side] = (sound.cryWaits[side]! - 1) | 0;
}

/**
 * `p`'s sounds this frame against `q`: its knockout cry (a kind-4 line, which echoes), the
 * finishing blow's sound when its blow knocks `q` out cleanly, its move's sounds, its script's
 * words due this frame; else a cry when hit cleanly (on odd frames, 40 frames apart, heavy blows'
 * from the second list), and now and then a grunt as its move changes; then the move's sound at the
 * start of its step window, its landings, and its last frame's.
 */
export function moveSounds(state: FightState, data: FightData, p: Fighter, q: Fighter): void {
  const sound = state.sound;
  const side = p.movesetSlot;
  const who = p.sound;
  const move = moveAt(data, p.move!);
  sound.quiet[side] = 0;
  if (p.hitClean !== 0 || (p.throwHold < 0 && p.framesShown === 1)) keyOff(state, 0);
  let spoke = false;
  let finished = false;
  if (p.knockedOut !== 0) {
    const lines = characterOf(data, who).lines;
    recordedLine(state, data, side, who, s16((((rand(state) & 0xff) * lines.counts[2]!) >> 8) | 0x4000));
    spoke = true;
  }
  if (q.health === 0 && q.hitClean !== 0) {
    recordedEffectLine(state, data, side, hitCode(data, p) < 0xb ? 0x7044 : 0x7048);
    finished = true;
  }
  if (move.sounds >= 0) {
    const list = data.sets[p.move!.set]!.moveset.sounds;
    for (let n = 0; n < 3; n += 1) {
      const entry = list[move.sounds + n];
      if (entry === undefined) throw new Error(`a move's sound list runs past its moveset's sounds`);
      if (entry === 0xffff) break;
      const firstFrame = p.frame === 1 && p.health !== 0 && sound.gruntWaits[side] === 0 && !spoke;
      switch (entry >> 12) {
        case 1:
        case 7:
          landed(state, data, p, q, entry, finished);
          break;
        case 2:
          if (firstFrame) {
            recordedLine(state, data, side, who, s16(entry));
            sound.gruntWaits[side] = characterOf(data, who).gruntWait;
          }
          break;
        case 3:
          if (firstFrame) {
            recordedLine(state, data, side, who, s16(entry));
            spoke = true;
          }
          break;
        case 4:
        case 5:
          recordedEffectLine(state, data, side, s16(entry));
          break;
        case 8: {
          const script = entry & 0xfff;
          if (script !== 0 && p.soundScriptStarted !== script) {
            p.soundScript = script;
            p.soundScriptStarted = script;
            p.soundScriptWord = 0;
            p.soundScriptFrame = s16(p.frame - 1);
          }
          break;
        }
        case 9:
          scriptEvent(state, data, p, q, entry & 0xfff);
          break;
      }
    }
  }
  if (p.hitReacting !== 0) endSoundScript(p);
  if (p.soundScript !== -1 && scriptsRun(state)) {
    const script = data.sound.scripts[p.soundScript];
    if (script === undefined) throw new Error(`sound script ${p.soundScript} is not imported`);
    p.soundScriptFrame = s16(p.soundScriptFrame + 1);
    for (;;) {
      const word = script[p.soundScriptWord];
      if (word === undefined) break;
      if (p.soundScriptFrame < word.frame) return countDown(state, side);
      if (p.soundScriptFrame === word.frame) scriptWord(state, data, p, q, word.kind, word.code);
      p.soundScriptWord = s16(p.soundScriptWord + 1);
    }
    endSoundScript(p);
    return countDown(state, side);
  }
  if (!spoke && p.health !== 0 && p.hitClean !== 0 && sound.cryWaits[side] === 0 && (state.frameCount & 1) !== 0) {
    const cries = characterOf(data, who).cries;
    let count = cries.light;
    let from = 0;
    if (0x13 < q.attackDamage) {
      count = cries.heavy;
      from = cries.light;
    }
    spoke = true;
    if (count !== 0) {
      recordedLine(state, data, side, who, cries.codes[from + (((rand(state) & 0xff) * count) >> 8)]!);
      sound.cryWaits[side] = 0x28;
    }
  }
  if (sound.gruntWaits[side] === 0 && !spoke) {
    if (p.attackDamage !== 0 && p.throwHold === 0 && p.moveStarted !== 0 && (rand(state) & 3) === 0) {
      const grunts = characterOf(data, who).grunts;
      recordedLine(state, data, side, who, grunts[(grunts.length * (rand(state) & 0xff)) >> 8]!);
      sound.gruntWaits[side] = characterOf(data, who).gruntWait;
    }
  }
  if (sound.quiet[side] === 0) {
    const frame = p.frame & 0xffff;
    if (frame === move.stepWindow.first && frame !== 1) recordedEffectLine(state, data, side, 0x1053);
    if (p.landedLightly !== 0 && sound.quiet[side] === 0) recordedEffectLine(state, data, side, 0x1054);
    if (p.landedHeavily !== 0 && sound.quiet[side] === 0) recordedEffectLine(state, data, side, 0x104f);
  }
  if (p.frame === move.activeWindow.first - 1) recordedEffectLine(state, data, side, 0x604a);
  countDown(state, side);
}
