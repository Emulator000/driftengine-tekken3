/**
 * What the fight reads from each model pack's model (`public/data/fighters/NN.3dmk`): its size (the
 * header's second word, in hundredths, made 4.12) and per record of 0x38 bytes from the file's
 * start (the header shares the first) the joint's offset from its parent (+0x24, +0x28 and +0x2c,
 * z negated as the game stores it), the parent record (+0x30, below zero none), and the three
 * halfwords an accessory rests at (+0x34, +0x38 and +0x3c, the last two read on into the next
 * record as the game reads them). And how many moves the pack's command list holds (its `.cmd`
 * file's first byte), which the pause menu's list scrolls through. The attract intros' models
 * (`public/data/intro/`) the same way, by the pack each stands for.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RECORDS = 0x1b;
const RECORD = 0x38;
const PACKS = 0x35;

/** A model file's record of what the fight reads, and its command list's length. */
function modelOf(bytes, commands) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (at) => (at + 4 <= bytes.length ? view.getInt32(at, true) : 0);
  const half = (at) => (at + 2 <= bytes.length ? view.getUint16(at, true) : 0);
  return {
    commands,
    size: Math.trunc((view.getUint32(4, true) << 12) / 100) & 0xffff,
    records: Array.from({ length: RECORDS }, (_, k) => {
      const at = k * RECORD;
      return { offset: [word(at + 0x24), word(at + 0x28), -word(at + 0x2c) | 0], parent: word(at + 0x30), rest: [half(at + 0x34), half(at + 0x38), half(at + 0x3c)] };
    }),
  };
}

export function fighterModels(root) {
  const packs = [];
  for (let pack = 0; pack < PACKS; pack += 1) {
    const file = path.join(root, `public/data/fighters/${String(pack).padStart(2, '0')}.3dmk`);
    if (!existsSync(file)) {
      packs.push(null);
      continue;
    }
    const commands = path.join(root, `public/data/fighters/${String(pack).padStart(2, '0')}.cmd`);
    packs.push(modelOf(new Uint8Array(readFileSync(file)), existsSync(commands) ? (readFileSync(commands)[0] ?? 0) : 0));
  }
  return packs;
}

/**
 * The attract intros' models by pack (`public/data/intro/I-PP.3dmk`, the pair each intro's table
 * names for the pack): what the fight reads from each, as from a pack's own; packs it names no pair
 * for are none.
 */
export function introModels(root, intros) {
  return intros.map(({ pairs }, intro) =>
    Array.from({ length: PACKS }, (_, pack) => {
      const pair = pairs[pack] ?? -1;
      const file = path.join(root, `public/data/intro/${intro}-${String(pair).padStart(2, '0')}.3dmk`);
      return pair < 0 || !existsSync(file) ? null : modelOf(new Uint8Array(readFileSync(file)), 0);
    }),
  );
}
