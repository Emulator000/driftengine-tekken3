/**
 * Kazuya's moveset as Tekken 3 reads it (moveset 15): Heihachi's file, whose generic states,
 * throws, camera shots and reactions Tekken 3 drives as it drives everyone's, with Kazuya's own
 * Tekken 4 moves put behind its move ids.
 *
 * Tekken 3 names a move by an id shared by every character (295 is the 1 from standing, 353 the d+1)
 * and lists in the executable send each input to its id; a character's file says which move an id
 * plays. Tekken 4's stance list, read for a fighter standing and facing the opponent (`applicable`),
 * names the move each input starts, so each id Heihachi's stance reaches with an input takes the move
 * Tekken 4's reaches with the same input. A move taken across keeps from Tekken 4 its motion
 * (converted, `retarget.mjs`), flags, hit level, damage, active frames and its own cancels (strings,
 * on new ids), and gets a hit track baked from its motion; from Heihachi's move for the same id, or
 * the nearest of his by level, limb and damage, it keeps how the opponent reacts and the rest.
 *
 * His Mishima inputs are Tekken 4's states (forward then neutral, then down, then down-forward, the
 * crouch dash), which Tekken 3 has as well, on ids every Mishima shares (102, 103, 105): his take
 * those ids, with his own motions and cancels.
 *
 * His crouch's attacks, and those rising out of it, take Tekken 4's for the same inputs as his
 * stance's do. No list of his stance leads to an attack of Heihachi's he does not have; what his
 * lists still reach of Heihachi's own motions is reported (`left`): his rising attacks from the
 * ground, some from a dash or a sidestep, and the victims' halves of Heihachi's throws.
 */
import { encodeT3Motion } from './t3motion.mjs';
import { convertFrame, restRotation } from './retarget.mjs';
import { readMotion } from './motion.mjs';
import { bonesOf, framesOf } from './kazuya.mjs';
import { JOINT_OF_NODE } from '../../../src/mod/kazuya/tekken4.ts';

const MOVE_BYTES = 0x38;
const ENTRY = 12;
const IDS = 4023;
const SHARED = 0x40000000;
const END = 0xc000;
const CALL = 0xc00c;
const RETURN = 0xc00d;
/** Where the executable's shared cancel lists are, and its image's address. */
const SHARED_CANCELS = 0x80017c78;
const EXE_AT = 0x80010000;
const STANCE = 3;
const MOVESET = 15;
const ROSTER = 22;
/** Tekken 4's character id for him, which some of its requirements test. */
const T4_CHARACTER = 14;
/** Ids no character, common list or executable list uses, for his strings and specials. */
const FREE_FROM = 3877;
/** A move's flag (`+4`) for one that leaves the ground, in both games. */
const AIRBORNE = 0x400;
/** The hit level's bit for a throw, in both games. */
const THROW = 0x400000;
/** Tekken 3's crouch, which Tekken 4's second alias (crouching) becomes. */
const CROUCH = 40;
/**
 * Tekken 3's lying face down where Heihachi's Demon Scissors lands, which Tekken 4's sixth alias
 * (where his own lands) becomes: the two lie the same way, their roots within half a degree.
 */
const FACE_DOWN = 157;
/** A Tekken 4 motion code's bit for one of his own (the rest are the shared bank's, 0x8000). */
const OWN_MOTION = 0x4000;
/** Tekken 3's 1+3 and 2+4 throws and Tekken 4's (his stance's 1+3 and 2+4, moves 419 and 420). */
const THROWS = [
  [2792, 419],
  [2796, 420],
];
/** A cancel's type that carries the frame on into the next move (2), with its no-blend bit (0x40). */
const CARRY_ON = 0x42;
/**
 * Whether a Tekken 4 cancel goes on into its move from the frame it is on, rather than from the move's
 * first: its transition word's 0x400 bit (0x8000 clear). Kazuya's strings that carry it open the next
 * move's motion as this one's (Tekken 4's u+4,4: the second motion is the first's for 24 frames).
 */
const goesOn = (cancel) => (cancel.extra & 0x8400) === 0x400;
/** A cancel's command that holds with no input. */
const ALWAYS = 0x10;
/** A cancel's type for a throw's connect, which hands the victim its move. */
const THROW_CONNECT = 0x21;
/** Tekken 4's property for a throw's damage at its frame, and Tekken 3's thrower event for it. */
const DAMAGE_PROPERTY = 0x8022;
const THROWER_HURTS = 0xb;
/**
 * Tekken 3's entrances (0, the short one; 2, the long one with its camera shot), win poses (0xd67
 * to 0xd6a, by the button held, 1 to 4) and time-up loser's stand (0xd6c), and his own Tekken 4
 * motions for them: his back turned into his stance (109), arms folded into it (110); the fist to
 * the ground (118), arms folded (108) and his two others (113, 114), the ones Tekken 4 plays for
 * the same buttons; arms folded (108). Tekken 4's lift of the beaten opponent by the neck (119) is
 * left out: it needs the opponent in it, and Tekken 3's winner poses alone.
 */
const POSES = new Map([
  [0, 109],
  [2, 110],
  [0xd67, 118],
  [0xd68, 108],
  [0xd69, 113],
  [0xd6a, 114],
  [0xd6c, 108],
]);
/** Where a round opens after the first (his stance, held), and the stand a round lost at time-up holds after 0xd6c, looping (his arms held folded, 108's last pose). */
const ROUND_OPENING = 1;
const BEATEN_HOLD = 0xd6d;
const HOLD_FRAMES = 60;

/* ---- Tekken 3's moveset file. ---- */

function readT3(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = Array.from({ length: 16 }, (_, k) => view.getUint32(k * 4, true));
  const [, cancelsAt, movesAt, idsAt, l10At, l14At, missingAt, motionsAt, camera20At, camera24At, hitsAt, endAt] = h;
  const count = view.getInt16(2, true);
  const cancels = [];
  for (let at = cancelsAt; at < movesAt; at += ENTRY) cancels.push(readEntry(view, at));
  const slice = (from, to) => bytes.slice(from, to);
  return {
    head: view.getUint16(0, true),
    cancels,
    moves: Array.from({ length: count }, (_, i) => slice(movesAt + i * MOVE_BYTES, movesAt + (i + 1) * MOVE_BYTES)),
    ids: Array.from({ length: IDS }, (_, i) => view.getUint32(idsAt + i * 4, true)),
    l10: slice(l10At, l14At),
    l14: slice(l14At, missingAt),
    missing: slice(missingAt, motionsAt),
    motions: slice(motionsAt, camera20At),
    camera20: slice(camera20At, camera24At),
    camera24: slice(camera24At, hitsAt),
    hits: slice(hitsAt, endAt),
  };
}

const readEntry = (view, at) => ({
  command: view.getUint16(at, true),
  cond: view.getUint8(at + 2),
  test: view.getUint8(at + 3),
  param: view.getUint16(at + 4, true),
  target: view.getUint16(at + 6, true),
  type: view.getUint8(at + 8),
  from: view.getUint8(at + 9),
  to: view.getUint8(at + 10),
  at: view.getUint8(at + 11),
});

/** A cancel list from index `first` to its end entry. */
function listAt(cancels, first) {
  const out = [];
  for (let k = first; ; k += 1) {
    out.push({ ...cancels[k] });
    if (cancels[k].command === END) return out;
  }
}

function writeT3(set) {
  const align = (n) => (n + 3) & ~3;
  const sizes = [set.cancels.length * ENTRY, set.moves.length * MOVE_BYTES, IDS * 4, set.l10.length, set.l14.length, set.missing.length, set.motions.length, set.camera20.length, set.camera24.length, set.hits.length];
  const at = [0x40];
  for (const size of sizes) at.push(align(at[at.length - 1] + size));
  const bytes = new Uint8Array(at[at.length - 1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, set.head, true);
  view.setInt16(2, set.moves.length, true);
  /* Header words +4 to +0x28, each section's offset; the rest the file's end. */
  for (let k = 0; k < 10; k += 1) view.setUint32(4 + k * 4, at[k], true);
  for (let k = 0x2c; k < 0x40; k += 4) view.setUint32(k, at[10], true);
  set.cancels.forEach((e, i) => {
    const a = at[0] + i * ENTRY;
    view.setUint16(a, e.command, true);
    view.setUint8(a + 2, e.cond);
    view.setUint8(a + 3, e.test);
    view.setUint16(a + 4, e.param, true);
    view.setUint16(a + 6, e.target, true);
    view.setUint8(a + 8, e.type);
    view.setUint8(a + 9, e.from);
    view.setUint8(a + 10, e.to);
    view.setUint8(a + 11, e.at);
  });
  set.moves.forEach((m, i) => bytes.set(m, at[1] + i * MOVE_BYTES));
  set.ids.forEach((v, i) => view.setUint32(at[2] + i * 4, v, true));
  [set.l10, set.l14, set.missing, set.motions, set.camera20, set.camera24, set.hits].forEach((blob, k) => bytes.set(blob, at[3 + k]));
  return bytes;
}

const moveView = (m) => new DataView(m.buffer, m.byteOffset, m.byteLength);

/* ---- Tekken 3's stance, as the executable's lists route it for him. ---- */

/** Whether an entry's condition byte holds for him (moveset 15, roster 22); the opponent's are not assumed. */
function conditionHolds(c) {
  if (c === 0) return true;
  if (c >= 0x5d) return c - 0x5d !== ROSTER;
  if (c >= 0x46) return c - 0x46 === ROSTER;
  if (c >= 0x2f) return false;
  if (c >= 0x18) return c - 0x18 !== MOVESET;
  return c - 1 === MOVESET;
}

/** A list's entries with its calls into the executable's shared lists followed. */
function expanded(list, exe) {
  const out = [];
  for (const e of list) {
    if (e.command !== CALL) {
      out.push(e);
      continue;
    }
    const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    for (let at = SHARED_CANCELS - EXE_AT + e.target * ENTRY; ; at += ENTRY) {
      const shared = readEntry(view, at);
      if (shared.command === RETURN || shared.command === END) break;
      out.push(shared);
    }
  }
  return out;
}

/** The ids a state of his (`id`) starts with a plain input (directions and buttons), in the order the game tries them. */
function inputSlots(heihachi, exe, id) {
  const state = heihachi.moves[heihachi.ids[id]];
  const list = listAt(heihachi.cancels, moveView(state).getUint32(0xc, true));
  return expanded(list, exe).filter((e) => e.command < 0xc000 && (e.command & 0xf) !== 0 && (e.command & 0x10) === 0 && e.test === 0 && conditionHolds(e.cond));
}

/* ---- Tekken 4's lists, read for a fighter standing and facing the opponent. ---- */

/** Requirement kinds judged for that moment; any other kind does not hold. */
const REQUIREMENTS = {
  0: () => true,
  0x5d: () => true,
  0x76: () => true,
  0xd2: () => true,
  /* The fighter is a given character. */
  0x77: (param) => param === T4_CHARACTER,
  /* Turned past a right angle from the opponent, or not. */
  0x2d: () => false,
  0x2e: () => true,
  0x33: () => false,
  0x34: () => false,
};

function holds(t4, index) {
  for (let k = index; k < t4.requirements.length; k += 1) {
    const r = t4.requirements[k];
    if (r.req === 263) return true;
    const judge = REQUIREMENTS[r.req];
    if (!judge || !judge(r.param)) return false;
  }
  return true;
}

const alias = (t4, target) => (target >= 0x8000 && target < 0x8020 ? t4.aliases[target - 0x8000] : target);

/** A Tekken 4 move's cancels that hold for the moment, in order, its group calls followed (each to its block's end, `0x8004`). */
function applicable(t4, moveIndex) {
  const out = [];
  const walk = (entries) => {
    for (const c of entries) {
      if (c.command === 0x8003) {
        if (!holds(t4, c.requirement)) continue;
        const block = [];
        for (let k = c.move; k < t4.groupCancels.length; k += 1) {
          const g = t4.groupCancels[k];
          if (g.command === 0x8004 || g.command === 0x8000) break;
          block.push(g);
        }
        walk(block);
        continue;
      }
      if (c.command === 0x8004 || !holds(t4, c.requirement)) continue;
      out.push({ ...c, target: alias(t4, c.move) });
      if (c.command === 0x8000) return true;
    }
    return false;
  };
  const list = [];
  for (let k = t4.moves[moveIndex].cancel; k < t4.cancels.length; k += 1) {
    list.push(t4.cancels[k]);
    if (t4.cancels[k].command === 0x8000) break;
  }
  walk(list);
  return out;
}

/** A Tekken 4 command's directions (numpad 1 to 9 as bits 0 to 8) and buttons (1 to 4 as bits 0 to 3). */
const t4Directions = (command) => (command >>> 1) & 0x1ff;
const t4Buttons = (command) => (command >>> 16) & 0xf;
const isPlain = (command) => command < 0x8000 || command >= 0x10000;

/** The Tekken 3 command for a Tekken 4 one: directions to bits 5 to 13, buttons to bits 0 to 3. */
const t3Command = (command) => ((t4Directions(command) << 5) | t4Buttons(command)) & 0xffff;

/* ---- Moves taken across. ---- */

/** Tekken 3's levels: the low byte and nibble say high, mid, low or special low. */
const LEVELS = [0x412, 0x217, 0x10f, 0x31f];
const levelClass = (level) => LEVELS.indexOf(level & 0xfff);
/** Joints of arms and legs (Tekken 3's), for which limb a move strikes with. */
const ARM_JOINTS = [3, 4, 5, 6, 7, 8, 9, 10];
const limbOf = (joint) => (joint === 0 ? -1 : ARM_JOINTS.includes(joint) ? 0 : 1);

/**
 * The builder: Heihachi's file, the common one, every character's (for the reactions they use), the executable,
 * Tekken 4's moveset (`moveset.mjs`), its two motion banks (his own and the common one,
 * `parseBank`), his model's nodes, Tekken 3's motion tables and his skeleton (`skeletonOf`).
 */
export function buildKazuyaMoveset({ heihachiBytes, commonBytes, movesets, exe, t4, ownBank, commonBank, nodes, tables, skeleton }) {
  const set = readT3(heihachiBytes);
  const originalIds = set.ids.slice();
  const common = readT3(commonBytes);
  /* Heihachi's own moves, before his are added. */
  const original = set.moves.length;
  const rest = nodes.map((n) => restRotation(n.rotation));
  const fixup = Array.from(tables.fixup, (v) => v / 4096);
  const offsets = Array.from(tables.offsets);
  const bones = bonesOf(nodes);

  /* Free ids, from the first one past everything used. */
  const missingBit = (id) => (new DataView(set.missing.buffer, set.missing.byteOffset).getUint16((id >> 4) * 2, true) >> (id & 15)) & 1;
  const setPresent = (id) => {
    const view = new DataView(set.missing.buffer, set.missing.byteOffset);
    view.setUint16((id >> 4) * 2, view.getUint16((id >> 4) * 2, true) & ~(1 << (id & 15)), true);
  };
  let nextId = FREE_FROM;
  const newId = () => {
    while (nextId < IDS && !missingBit(nextId)) nextId += 1;
    if (nextId >= IDS) throw new Error('no free move ids left for Kazuya');
    return nextId++;
  };

  /* Appending to the file's pools. */
  const grow = (key, extra) => {
    const at = set[key].length;
    const next = new Uint8Array(at + extra.length);
    next.set(set[key]);
    next.set(extra, at);
    set[key] = next;
    return at;
  };
  const addMotion = (frames) => {
    const data = encodeT3Motion(frames);
    const pad = (4 - ((set.motions.length + 2) & 3)) & 3;
    const at = grow('motions', new Uint8Array(pad + 2 + data.length));
    set.motions.set(data, at + pad + 2);
    return at + pad + 2;
  };
  const addList = (entries) => {
    const at = set.cancels.length;
    set.cancels.push(...entries);
    return at;
  };
  const addMove = (record) => {
    set.moves.push(record);
    return set.moves.length - 1;
  };
  /** A move's events (`+0x20`: a frame, then a code and its argument, ended by frame 0), its index in fours. */
  const addEvents = (events) => {
    const bytes = new Uint8Array((events.length + 1) * 4);
    const view = new DataView(bytes.buffer);
    events.forEach((e, k) => {
      view.setUint16(k * 4, e.frame, true);
      view.setUint16(k * 4 + 2, (e.code << 8) | e.arg, true);
    });
    return grow('l14', bytes) / 4;
  };

  /*
   * A move's sounds (`+0x1c`, a halfword index into the sound lists, -1 for none; up to three
   * halfwords to 0xffff): his lines where Tekken 4 calls them (kinds 2 and 3, his line by kind and
   * number, the same in both games), the rest (hit sounds, scripts, effect lines) Heihachi's, which
   * name Tekken 3's tables.
   */
  const soundsAt = (index) => {
    const out = [];
    if (index < 0) return out;
    const view = new DataView(set.l10.buffer, set.l10.byteOffset, set.l10.byteLength);
    for (let k = index * 2; k + 2 <= set.l10.length && out.length < 8; k += 2) {
      const entry = view.getUint16(k, true);
      if (entry === 0xffff) break;
      out.push(entry);
    }
    return out;
  };
  const addSounds = (entries) => {
    const bytes = new Uint8Array((entries.length + 1) * 2);
    const view = new DataView(bytes.buffer);
    entries.forEach((e, k) => view.setUint16(k * 2, e, true));
    view.setUint16(entries.length * 2, 0xffff, true);
    return grow('l10', bytes) / 2;
  };
  const isLine = (entry) => entry >> 12 === 2 || entry >> 12 === 3;
  /** Tekken 4's line calls for its move `index` (none for -1). */
  const t4Lines = (index) => {
    const voice = index < 0 ? 0xffffffff : t4.moves[index].voice;
    const out = [];
    if (voice === 0xffffffff) return out;
    for (let k = voice; k < t4.voices.length && t4.voices[k] !== 0xffff; k += 1) if (isLine(t4.voices[k])) out.push(t4.voices[k]);
    return out;
  };
  /** A move record's sounds: Tekken 4's lines for move `index`, Heihachi's other sounds after, three at most. */
  const withVoices = (record, index) => {
    const view = moveView(record);
    const own = soundsAt(view.getInt32(0x1c, true));
    const sounds = [...new Set(t4Lines(index))].concat(own.filter((e) => !isLine(e))).slice(0, 3);
    if (sounds.length === own.length && sounds.every((e, k) => e === own[k])) return;
    view.setInt32(0x1c, sounds.length === 0 ? -1 : addSounds(sounds), true);
  };

  /* Tekken 4 motions as Tekken 3 channel frames, the move's own length at most. */
  const motionFrames = (code, length) => {
    const bank = code >= 0x8000 ? commonBank : ownBank;
    const motion = readMotion(bank.bytes, bank.offsets[code & 0x3fff]);
    const count = Math.max(1, Math.min(motion.frames, length || motion.frames, 0xff));
    return Array.from({ length: count }, (_, f) => convertFrame(motion.frame(f), fixup, offsets, rest, bones).map(Math.round));
  };

  /* Heihachi's attacks by id, to borrow from. */
  const heihachiMove = (id) => {
    const entry = set.ids[id];
    return entry < SHARED ? set.moves[entry] : null;
  };
  const hitBytes = (record) => {
    const view = moveView(record);
    const reactions = view.getInt32(0x28, true);
    if (reactions < 4 || reactions - 4 + 4 > set.hits.length) return [0, 0, 0, 0];
    return Array.from(set.hits.subarray(reactions - 4, reactions));
  };
  const borrowable = [];
  for (let id = 295; id <= 371; id += 1) {
    const record = heihachiMove(id);
    if (!record) continue;
    const view = moveView(record);
    if (view.getUint8(0x2d) === 0) continue;
    borrowable.push({ id, record, level: view.getUint32(8, true), damage: view.getUint16(0x14, true) & 0x3fff, limb: limbOf(hitBytes(record)[0]) });
  }
  const nearest = (level, limb, damage) => {
    let best = null;
    for (const b of borrowable) {
      const score = (b.level === level ? 8 : 0) + (levelClass(b.level) === levelClass(level) ? 4 : 0) + (b.limb === limb ? 2 : 0) - Math.abs(b.damage - damage) / 10;
      if (!best || score > best.score) best = { score, record: b.record };
    }
    return best.record;
  };

  /* A pose's joints in the fighter's space, as the game's hit tracks hold them (x and z turned about Y). */
  const jointAt = (channels, joint) => {
    const t = framesOf(channels, skeleton, tables)[joint].t;
    return [-t[0], t[1], -t[2]];
  };
  const packPoint = (p) => {
    const x = (Math.round(p[0]) + 0x1000) & 0x1fff;
    const y = (Math.round(p[1]) + 0x1000) & 0x1fff;
    const z = (Math.round(p[2]) + 0x2000) & 0x3fff;
    const low = (x | (y << 13) | ((z & 0x3f) << 26)) >>> 0;
    return [low & 0xff, (low >>> 8) & 0xff, (low >>> 16) & 0xff, (low >>> 24) & 0xff, (z >> 6) & 0xff];
  };

  /**
   * A move's hit data: the four hit bytes (Tekken 4's nodes as Tekken 3's joints), the layout, and
   * a point or two per active frame (and the frame before, where a point sweeps), each segment a
   * joint swept from its last place or two joints held as a segment.
   */
  const bakeHits = (hits, frames, start, end) => {
    const segments = [[hits[0], hits[1]], [hits[2], hits[3]]].filter(([a]) => a !== 0);
    const header = [...hits, 0, 0];
    if (segments.length === 0 || start === 0) return new Uint8Array(header);
    const swept = segments.map(([, b]) => b === 0);
    const layout = segments.length === 1 ? (swept[0] ? 1 : 0) : swept[0] ? (swept[1] ? 2 : 4) : swept[1] ? 3 : 5;
    header[5] = layout;
    const at = (g) => frames[Math.max(0, Math.min(frames.length - 1, g - 1))];
    const bytes = [...header];
    /* The points before the first active frame, for the segments that sweep. */
    segments.forEach(([a], k) => {
      if (swept[k]) bytes.push(...packPoint(jointAt(at(start - 1), a)));
    });
    for (let g = start; g <= end; g += 1) {
      for (const [a, b] of segments) {
        if (b === 0) bytes.push(...packPoint(jointAt(at(g), a)));
        else bytes.push(...packPoint(jointAt(at(g), b)), ...packPoint(jointAt(at(g), a)));
      }
    }
    return new Uint8Array(bytes);
  };
  const addHits = (data) => {
    const at = grow('hits', data);
    if (at + 4 >= 0x7ff0) throw new Error('Kazuya’s hit data runs into the shared reaction keys');
    return at + 4;
  };

  /* Tekken 4 moves taken across, by index: their Tekken 3 id. */
  const converted = new Map();
  const pending = [];
  /* States (no hits) taken across, whose lists end with Tekken 3's generic entries once every id is settled. */
  const states = [];

  const t4Hits = (move) => [0, 8, 16, 24].map((s) => {
    const node = (move.w2c >>> s) & 0xff;
    return node === 0 ? 0 : (JOINT_OF_NODE.get(node) ?? 0);
  });
  /** A move with active frames, a throw aside (a throw needs its victim's half, not taken across yet). */
  const isAttack = (index) => {
    const move = t4.moves[index];
    return move && move.startup > 0 && move.hitLevel !== 0 && (move.hitLevel & THROW) === 0;
  };

  /*
   * How the opponent reacts: a Tekken 3 move names a row of reactions (`ROWS`, 42 bytes: the
   * move the one hit plays from the front, on a counter, from either side, from behind and blocking,
   * each standing and crouching, then its push), a Tekken 4 hit a list of the same (`reactions`: 14
   * moves, standing then crouching for each). Over the inputs both characters have, Tekken 4's
   * reaction moves are matched to Tekken 3's by vote; each of his moves then takes, of the rows
   * Tekken 3's characters use, the one that reacts most as his list does.
   */
  const ROW_BYTES = 0x2a;
  const ROWS = 0x80010ce8;
  const exeView = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const rowOf = (word) => Array.from({ length: 12 }, (_, k) => exeView.getInt16(ROWS - EXE_AT + word * ROW_BYTES + k * 2, true));
  /* A row's twelve moves against a Tekken 4 list's: front, counter, one side, the other, behind, blocked. */
  const SITUATIONS = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]];
  const WEIGHTS = [4, 2, 1, 1, 1, 1];
  const t4Reactions = (move) => t4.reactions[hitCondition(move)?.reaction]?.moves;
  function learnReactions(learned) {
    const votes = new Map();
    for (const { heihachi, t4: index } of learned) {
      const word = moveView(heihachi).getUint16(0x32, true);
      const list = t4Reactions(t4.moves[index]);
      if ((word & 0xf000) !== 0 || !list) continue;
      const row = rowOf(word);
      SITUATIONS.forEach(([crouching, standing], k) => {
        for (const [t3, t4Move] of [[row[standing], list[k * 2]], [row[crouching], list[k * 2 + 1]]]) {
          if (!votes.has(t4Move)) votes.set(t4Move, new Map());
          votes.get(t4Move).set(t3, (votes.get(t4Move).get(t3) ?? 0) + 1);
        }
      });
    }
    const as = new Map([...votes].map(([t4Move, counts]) => [t4Move, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
    /* Every row a character of the disc's names, the empty ones aside. */
    const words = new Set();
    for (const bytes of movesets) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const movesAt = view.getUint32(8, true);
      const count = view.getInt16(2, true);
      for (let i = 0; i < count; i += 1) {
        const at = movesAt + i * MOVE_BYTES;
        if (view.getUint8(at + 0x2d) === 0) continue;
        const word = view.getUint16(at + 0x32, true);
        if ((word & 0xf000) === 0 && rowOf(word)[1] !== 0) words.add(word);
      }
    }
    const candidates = [...words].map((word) => ({ word, row: rowOf(word) }));
    /* Where his list says nothing Tekken 3 knows, the reaction Tekken 3's rows most often have there. */
    const usual = Array.from({ length: 12 }, (_, column) => {
      const counts = new Map();
      for (const { row } of candidates) counts.set(row[column], (counts.get(row[column]) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1])[0][0];
    });
    /* Whether a reaction leaves the ground: the flag (0x400) both games' moves carry. */
    const t3Airborne = (id) => {
      const entry = set.ids[id];
      const record = entry < SHARED ? set.moves[entry] : common.moves[entry - SHARED];
      return record !== undefined && (moveView(record).getUint32(4, true) & AIRBORNE) !== 0;
    };
    const t4Airborne = (index) => ((t4.moves[index]?.vulnerability ?? 0) & AIRBORNE) !== 0;
    const agree = (t4Move, row, column, weight) => {
      if (t4Airborne(t4Move) !== t3Airborne(row[column])) return -weight;
      const t3 = as.get(t4Move);
      if (t3 !== undefined) return t3 === row[column] ? weight : 0;
      return row[column] === usual[column] ? weight / 10 : 0;
    };
    return (move, fallback) => {
      const list = t4Reactions(move);
      if (!list) return fallback;
      let best = { word: fallback, score: -Infinity };
      for (const { word, row } of candidates) {
        let score = 0;
        SITUATIONS.forEach(([crouching, standing], k) => {
          score += agree(list[k * 2], row, standing, WEIGHTS[k]);
          score += agree(list[k * 2 + 1], row, crouching, WEIGHTS[k] / 2);
        });
        if (score > best.score || (score === best.score && word === fallback)) best = { word, score };
      }
      return best.word;
    };
  }

  /** A Tekken 4 hit's outcome for the moment: the first of its conditions that holds (the last holds always). */
  function hitCondition(move) {
    for (let k = move.hitCondition; k < t4.hitConditions.length; k += 1) {
      const condition = t4.hitConditions[k];
      if (holds(t4, condition.requirement)) return condition;
      if (t4.requirements[condition.requirement]?.req === 263) return condition;
    }
    return undefined;
  }

  /** The Tekken 3 id a Tekken 4 move plays as, taking it across on first use. */
  const idFor = (index, slot, template, state = false) => {
    if (converted.has(index)) return converted.get(index);
    const id = slot ?? newId();
    converted.set(index, id);
    pending.push({ index, id, template, state });
    return id;
  };

  /** The Tekken 3 id for where a Tekken 4 move goes on to: a move taken across, crouching, lying face down, else his stance. */
  const followUp = (target) => {
    if (converted.has(target)) return converted.get(target);
    const to = alias(t4, target);
    return to === t4.aliases[2] ? CROUCH : to === t4.aliases[6] ? FACE_DOWN : STANCE;
  };

  /** The state a Tekken 4 move goes to on one direction alone (numpad), if any. */
  const onDirection = (index, numpad) => applicable(t4, index).find((e) => isPlain(e.command) && t4Buttons(e.command) === 0 && t4Directions(e.command) === 1 << (numpad - 1))?.target;

  const takeAcross = ({ index, id, template, state }) => {
    const move = t4.moves[index];
    const entries = applicable(t4, index);
    const end = entries.find((e) => e.command === 0x8000);
    const length = end && end.start > 0 ? end.start + 1 : 0;
    const frames = motionFrames(move.motion, length);
    const hits = t4Hits(move);
    const level = move.hitLevel >>> 0;
    const condition = hitCondition(move);
    const damage = move.startup > 0 && condition ? condition.damage : 0;
    const record = Uint8Array.from(template ?? nearest(level, limbOf(hits[0]), damage));
    const view = moveView(record);

    /*
     * Its cancels: strings to the attacks they start, an attack's own step on to the next at a frame
     * with no input, a state's moves on to the states taken across, then its end. A string Tekken 4
     * plays on from the frame it is on (`goesOn`) carries the frame on, unblended, as Tekken 3's own
     * strings that branch partway through one motion do (Heihachi's Spinning Demon): the next move's
     * motion opens as this one does, so its frame there is this frame's pose.
     */
    const list = [];
    for (const e of entries) {
      if (e.command === 0x8000) break;
      if (!isPlain(e.command)) continue;
      const window = { cond: 0, test: 0, param: 0, from: Math.min(e.start, 0xff), to: Math.min(e.end, 0xff), at: Math.min(e.frame, 0xff) };
      const onward = e.target !== index && (goesOn(e) || t4.moves[e.target]?.motion === move.motion);
      if (t4Buttons(e.command) !== 0 && isAttack(e.target)) list.push({ ...window, command: t3Command(e.command), target: idFor(e.target), type: onward ? CARRY_ON : 0xc });
      else if (e.command === 0 && isAttack(index) && isAttack(e.target)) list.push({ ...window, command: ALWAYS, target: idFor(e.target), type: 6 });
      else if (state && t4Buttons(e.command) === 0 && converted.has(e.target) && e.target !== index && t4Directions(e.command) !== 0) {
        list.push({ ...window, command: t3Command(e.command) | 0x10, target: converted.get(e.target), type: 6 });
      }
    }
    const last = { command: END, cond: 0, test: 0, param: 0, target: end ? followUp(end.target) : STANCE, type: 6, from: end ? Math.min(end.start, 0xff) : frames.length, to: 0xff, at: end ? Math.min(end.frame, 0xff) : frames.length };

    view.setUint32(0, addMotion(frames), true);
    view.setUint32(4, move.vulnerability >>> 0, true);
    view.setUint32(8, level, true);
    view.setUint16(0x10, followUp(move.transition), true);
    view.setUint16(0x14, (view.getUint16(0x14, true) & 0xc000) | (damage & 0x3fff), true);
    view.setInt32(0x20, -1, true);
    view.setUint8(0x2d, move.startup);
    view.setUint8(0x2e, move.active);
    view.setInt32(0x28, addHits(bakeHits(hits, frames, move.startup, move.active)), true);
    if (move.startup > 0) view.setUint16(0x32, reactionRow(move, view.getUint16(0x32, true)), true);
    withVoices(record, index);
    if (state) states.push({ view, list, last, heihachi: template });
    else view.setUint32(0xc, addList([...list, last]), true);
    const at = addMove(record);
    set.ids[id] = at;
    setPresent(id);
  };

  /*
   * A state's inputs: each id it starts takes Tekken 4's move for the same input in its own state,
   * where that is an attack. `matches` says whether Tekken 4's directions (numpad bits) stand for
   * Tekken 3's, and `only` which of the ids to take.
   */
  const report = [];
  const shared = [];
  /* Heihachi's move and Kazuya's for the same input, for learning how Tekken 4's reactions read in Tekken 3. */
  const pairs = [];
  const taken = [];
  const pairInputs = (slots, t4List, matches, only = () => true) => {
    for (const slot of slots) {
      if (taken.includes(slot.target) || !only(slot.target)) continue;
      const directions = (slot.command >> 5) & 0x1ff;
      const buttons = slot.command & 0xf;
      const match = t4List.find((e) => isPlain(e.command) && t4Buttons(e.command) === buttons && matches(t4Directions(e.command), directions));
      if (!match || !isAttack(match.target)) continue;
      taken.push(slot.target);
      pairs.push({ heihachi: heihachiMove(slot.target), t4: match.target });
      /* Two inputs Tekken 4 sends to one move both play it. */
      if (converted.has(match.target)) shared.push({ id: slot.target, t4: match.target });
      else idFor(match.target, slot.target, heihachiMove(slot.target));
      report.push({ id: slot.target, command: slot.command, t4: match.target });
    }
  };
  /* His stance's. */
  const t4Stance = applicable(t4, t4.aliases[1]);
  pairInputs(inputSlots(set, exe, STANCE), t4Stance, (t4Dirs, dirs) => dirs !== 0 && (t4Dirs & dirs) === dirs);
  /*
   * His crouch's, those of Heihachi's own (the attacks from a crouch and from rising out of it, which
   * the other crouching states reach on the same ids): a Tekken 3 input of no direction is one held
   * down with any, as a Tekken 4 one of none is.
   */
  const heihachiOwnAttack = (id) => {
    const record = heihachiMove(id);
    return record !== null && moveView(record).getUint32(8, true) !== 0 && moveView(record).getUint32(0, true) < SHARED;
  };
  pairInputs(inputSlots(set, exe, CROUCH), applicable(t4, t4.aliases[2]), (t4Dirs, dirs) => (dirs === 0 ? t4Dirs === 0 : t4Dirs === 0 || (t4Dirs & dirs) === dirs), heihachiOwnAttack);

  /*
   * The Mishima states, on Tekken 3's ids for them: forward then neutral (102), then down (103), then
   * down-forward, the crouch dash (105). Tekken 4 reaches them from walking forward.
   */
  const walking = onDirection(t4.aliases[1], 6);
  const forwardNeutral = walking === undefined ? undefined : onDirection(walking, 5);
  if (forwardNeutral !== undefined) {
    const mishima = [[forwardNeutral, 102], [onDirection(forwardNeutral, 2), 103], [onDirection(forwardNeutral, 3), 105]];
    /* Every state's id first, so their lists can name each other. */
    for (const [index, id] of mishima) if (index !== undefined && !converted.has(index)) converted.set(index, id);
    for (const [index, id] of mishima) if (index !== undefined) pending.push({ index, id, template: heihachiMove(id), state: true });
    /* Their attacks, paired by input with Heihachi's in the same states. */
    for (const [index, id] of mishima) {
      const record = heihachiMove(id);
      if (index === undefined || !record) continue;
      const t4List = applicable(t4, index);
      for (const e of listAt(set.cancels, moveView(record).getUint32(0xc, true))) {
        if (e.command >= 0xc000 || (e.command & 0xf) === 0 || !conditionHolds(e.cond) || !heihachiMove(e.target)) continue;
        const directions = (e.command >> 5) & 0x1ff;
        const match = t4List.find((c) => isPlain(c.command) && t4Buttons(c.command) === (e.command & 0xf) && (directions === 0 || (t4Directions(c.command) & directions) !== 0) && isAttack(c.target));
        if (match) pairs.push({ heihachi: heihachiMove(e.target), t4: match.target });
      }
    }
  }
  const reactionRow = learnReactions(pairs);

  /* Taken across, strings and all: each move may name more. */
  while (pending.length > 0) takeAcross(pending.shift());
  for (const { id, t4: index } of shared) {
    set.ids[id] = set.ids[converted.get(index)];
    setPresent(id);
  }
  /*
   * Where Heihachi's file plays two ids as one move (his d/f+1+2 is his d/f+1, his d+1+2 and
   * d/b+1+2 his d/b+1), the one left plays as the one taken across.
   */
  const twinOf = new Map(report.map(({ id }) => [originalIds[id], id]));
  for (let id = 0; id < IDS; id += 1) {
    const twin = twinOf.get(originalIds[id]);
    if (twin !== undefined && twin !== id && set.ids[id] === originalIds[id]) set.ids[id] = set.ids[twin];
  }

  /* His stance's own motion. */
  const stance = Uint8Array.from(set.moves[set.ids[STANCE]]);
  moveView(stance).setUint32(0, addMotion(motionFrames(t4.moves[t4.aliases[1]].motion, 0)), true);
  set.ids[STANCE] = addMove(stance);

  /*
   * His moving and crouching: the states one input from the stance (walking, dashing, crouching
   * down) in each game paired by that input, and on from each by where it ends (Tekken 3's end
   * entry, Tekken 4's transition), take his Tekken 4 motions; Tekken 3 keeps driving them.
   */
  const heihachiState = (id) => {
    const entry = set.ids[id];
    if (entry >= original && entry < SHARED) return false;
    const record = entry < SHARED ? set.moves[entry] : common.moves[entry - SHARED];
    return record !== undefined && moveView(record).getUint8(0x2d) === 0;
  };
  const t4State = (index) => t4.moves[index] !== undefined && t4.moves[index].startup === 0;
  const moving = new Map();
  const pairState = (id, index, depth) => {
    if (depth > 3 || id === STANCE || moving.has(id) || [...converted.values()].includes(id) || !heihachiState(id) || !t4State(index)) return;
    moving.set(id, index);
    const entry = set.ids[id];
    const record = entry < SHARED ? set.moves[entry] : common.moves[entry - SHARED];
    const end = listAt(entry < SHARED ? set.cancels : common.cancels, moveView(record).getUint32(0xc, true)).find((e) => e.command === END);
    if (end) pairState(end.target, alias(t4, t4.moves[index].transition), depth + 1);
  };
  for (const e of expanded(listAt(set.cancels, moveView(stance).getUint32(0xc, true)), exe)) {
    if (e.test !== 0 || !conditionHolds(e.cond)) continue;
    let match;
    if (e.command === 0xc001 || e.command === 0xc002) match = t4Stance.find((c) => c.command === (e.command === 0xc001 ? 0x8001 : 0x8002));
    else if (e.command < 0xc000 && ((e.command & 0x1f) === 0x10 || (e.command & 0x1f) === 0)) {
      const directions = (e.command >> 5) & 0x1ff;
      if (directions === 0 || (directions & (directions - 1)) !== 0) continue;
      match = t4Stance.find((c) => isPlain(c.command) && t4Buttons(c.command) === 0 && (t4Directions(c.command) & directions) !== 0);
    }
    if (match) pairState(e.target, match.target, 0);
  }
  /* A Tekken 3 move by id kept, his motion in it and its end at his motion's (where Tekken 3's waits for its own to finish). */
  const withMotion = (id, code, index = -1, frames = motionFrames(code, 0)) => {
    const entry = set.ids[id];
    const own = entry < SHARED;
    const record = Uint8Array.from(own ? set.moves[entry] : common.moves[entry - SHARED]);
    const view = moveView(record);
    const list = listAt(own ? set.cancels : common.cancels, view.getUint32(0xc, true)).map((e) =>
      e.command === END && e.from > 0 ? { ...e, from: Math.min(frames.length, 0xff), at: Math.min(frames.length, 0xff) } : e,
    );
    view.setUint32(0, addMotion(frames), true);
    view.setUint32(0xc, addList(list), true);
    if (own) withVoices(record, index);
    if (!own) {
      view.setInt32(0x1c, -1, true);
      view.setInt32(0x20, -1, true);
    }
    set.ids[id] = addMove(record);
    setPresent(id);
  };
  for (const [id, index] of moving) withMotion(id, t4.moves[index].motion, index);

  /*
   * His entrances, win poses and the stand of a round lost at time-up: Tekken 3 starts them by id,
   * Tekken 4 plays his from the moves past its stance's (893 to 907), each a motion of his own:
   * Heihachi's records and camera shots keep them, his motions in them. A round after the first
   * opens on his stance, and a round lost at time-up holds his last pose.
   */
  for (const [id, motion] of POSES) withMotion(id, OWN_MOTION | motion);
  withMotion(ROUND_OPENING, t4.moves[t4.aliases[1]].motion);
  const folded = motionFrames(OWN_MOTION | POSES.get(0xd6c), 0);
  withMotion(BEATEN_HOLD, OWN_MOTION | POSES.get(0xd6c), -1, Array.from({ length: HOLD_FRAMES }, () => folded[folded.length - 1]));

  /*
   * His throws. Tekken 4's descend from Tekken 3's: an attempt's cancels on its connect test the
   * same sides with the same parameter (Tekken 3's test byte, Tekken 4's requirement: 4 and 5 the
   * sides, 3 the back, 2 the front, 1536) for the execution, and the execution names the victim's
   * move (Tekken 3 through its reaction row at `+0x32`, Tekken 4 as its reaction list's first).
   * Each of Heihachi's (the attempt, the executions, the victims) takes his motion, an execution his
   * damage and its moments (Tekken 4's property 0x8022 at a frame, its value the damage or 0 for
   * the move's, as Tekken 3's thrower event 0xb), a victim no events of Heihachi's timing; the
   * victim plays its move from his file, as every throw's victim does.
   */
  const throwVictim = (record) => {
    const reaction = moveView(record).getUint16(0x32, true);
    const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    return (reaction & 0xf000) === 0 ? view.getInt16(0x80010ce8 - EXE_AT + reaction * 0x2a, true) : view.getInt16(0x800174c4 - EXE_AT + (reaction & 0xfff) * 2, true);
  };
  /** A Tekken 4 move's cancels as written (none of their requirements tested), to its end entry. */
  const t4Cancels = (index) => {
    const out = [];
    for (let k = t4.moves[index].cancel; k < t4.cancels.length && t4.cancels[k].command !== 0x8000; k += 1) out.push(t4.cancels[k]);
    return out;
  };
  /** A Tekken 4 move's properties (a frame, bit 15 for one that repeats, an id and a value), to their end. */
  const t4Properties = (move) => {
    const out = [];
    for (let k = move.property; k < t4.properties.length && !(t4.properties[k].frame === 0 && t4.properties[k].id === 0); k += 1) {
      out.push({ ...t4.properties[k], frame: t4.properties[k].frame & 0x7fff });
    }
    return out;
  };
  /** Whether a Tekken 4 requirement list is the one requirement `req` with `param`. */
  const sameRequirement = (at, req, param) =>
    t4.requirements[at]?.req === req && t4.requirements[at].param === param && t4.requirements[at + 1]?.req === 263;
  const thrown = new Set();
  for (const [attempt, index] of THROWS) {
    const t3List = listAt(set.cancels, moveView(set.moves[set.ids[attempt]]).getUint32(0xc, true));
    withMotion(attempt, t4.moves[index].motion, index);
    for (const e of t3List) {
      if (e.type !== THROW_CONNECT || thrown.has(e.target)) continue;
      const t4Cancel = t4Cancels(index).find((c) => c.command === 0 && sameRequirement(c.requirement, e.test, e.param));
      if (!t4Cancel) throw new Error(`his throw ${index} has no execution for Tekken 3's side ${e.test}`);
      const execution = t4.moves[t4Cancel.move];
      const victim = throwVictim(set.moves[set.ids[e.target]]);
      withMotion(e.target, execution.motion, t4Cancel.move);
      const view = moveView(set.moves[set.ids[e.target]]);
      view.setUint16(0x14, (view.getUint16(0x14, true) & 0xc000) | (hitCondition(execution).damage & 0x3fff), true);
      const hurts = t4Properties(execution).filter((p) => p.id === DAMAGE_PROPERTY);
      if (hurts.length === 0) throw new Error(`his throw ${t4Cancel.move} never hurts`);
      view.setInt32(0x20, addEvents(hurts.map((p) => ({ frame: p.frame, code: THROWER_HURTS, arg: p.value & 0xff }))), true);
      if (!thrown.has(victim)) {
        const reaction = t4.reactions[hitCondition(execution).reaction].moves[0];
        withMotion(victim, t4.moves[reaction].motion, reaction);
        moveView(set.moves[set.ids[victim]]).setInt32(0x20, -1, true);
      }
      thrown.add(e.target);
      thrown.add(victim);
    }
  }

  /*
   * No list of his leads to one of Heihachi's attacks: a Heihachi state keeps its moving, guarding
   * and shared entries and loses the rest, and the states taken across end with the same of
   * Heihachi's lists for them. Throws come through the executable's lists, his own still to come.
   */
  const heihachiAttack = (id) => {
    const entry = set.ids[id];
    if (entry >= SHARED || entry >= original) return false;
    return moveView(set.moves[entry]).getUint32(8, true) !== 0;
  };
  const generic = (list) => list.filter((e) => e.command !== END && (e.command === CALL || !heihachiAttack(e.target)));
  for (const { view, list, last, heihachi } of states) {
    view.setUint32(0xc, addList([...list, ...(heihachi ? generic(listAt(set.cancels, moveView(heihachi).getUint32(0xc, true))) : []), last]), true);
  }
  /* An id still on a move of Heihachi's file with a motion of his own. */
  const heihachiOwn = (id) => set.ids[id] < original && moveView(set.moves[set.ids[id]]).getUint32(0, true) < SHARED;
  /* His stance's buttons start nothing of Heihachi's own besides (his poses on 1+2+3+4 and 2+3+4). */
  const ownStance = set.ids[STANCE];
  const button = (e) => e.command < 0xc000 && (e.command & 0xf) !== 0;
  const ownStates = new Set([ownStance, ...[...moving.keys()].map((id) => set.ids[id])]);
  for (let i = 0; i < set.moves.length; i += 1) {
    if (i >= original && !ownStates.has(i)) continue;
    const view = moveView(set.moves[i]);
    if (view.getUint32(8, true) !== 0) continue;
    const list = listAt(set.cancels, view.getUint32(0xc, true));
    const kept = list.filter((e) => e.command === END || e.command === CALL || !(heihachiAttack(e.target) || (i === ownStance && button(e) && heihachiOwn(e.target))));
    if (kept.length !== list.length) view.setUint32(0xc, addList(kept), true);
  }

  /* What his lists still reach of Heihachi's own motions, from his stance. */
  const left = [];
  const seen = new Set();
  const queue = [STANCE];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id >= IDS || seen.has(id) || missingBit(id)) continue;
    seen.add(id);
    if (heihachiOwn(id)) left.push(id);
    const entry = set.ids[id];
    const record = entry < SHARED ? set.moves[entry] : common.moves[entry - SHARED];
    if (!record) continue;
    const list = listAt(entry < SHARED ? set.cancels : common.cancels, moveView(record).getUint32(0xc, true));
    for (const e of expanded(list, exe)) if (conditionHolds(e.cond)) queue.push(e.target);
    queue.push(moveView(record).getUint16(0x10, true));
  }

  return { bytes: writeT3(set), moves: converted.size, report, converted, moving, left: left.sort((a, b) => a - b) };
}
