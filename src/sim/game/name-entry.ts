/**
 * The records' name entry: a record's holder picks three letters, one at a time, from the 40 the
 * entry turns through. Left and right (repeating while held) move the letter round, and it shows
 * at the cursor's place; any of the four buttons takes it: `<` clears the place and steps the
 * cursor back, `=` ends the name, any other letter is written and the cursor moves on, the name
 * ending with its third. An ended name's places left are spaces, and a name the entry refuses
 * becomes the first three letters of the holder's character's name, as does a name cut short.
 */
import type { NameTables } from '../data/scenes.ts';
import type { NameEntry } from './state.ts';

/** How the entry takes a frame: from the holder's pad, out of time, or cut short. */
export const NameStep = { PAD: 0, OUT_OF_TIME: 1, CUT_SHORT: 2 } as const;
/** What a frame leaves: the name still open, ended, or ended spelling the secret name. */
export const NameResult = { OPEN: 0, ENDED: 1, SECRET: 2 } as const;

/** A name's letters. */
const LENGTH = 3;
/** The pad's bits: right and left move the letter, the four buttons take it. */
const RIGHT = 0x2000;
const LEFT = 0x8000;
const BUTTONS = 0xf0;
const BACK = '<';
const END = '=';
const SPACE = ' ';

/** The entry started for the holder on `pad` playing `roster`: the blank name, the cursor on its first place and the first letter. */
export function startNameEntry(entry: NameEntry, tables: NameTables, pad: number, roster: number): void {
  entry.pad = pad;
  entry.roster = roster;
  entry.name = tables.blank;
  entry.place = 0;
  entry.letter = 0;
  entry.took = 0;
  entry.moved = 0;
}

/** `letter` written at the name's place `place`. */
const put = (entry: NameEntry, place: number, letter: string): void => void (entry.name = entry.name.slice(0, place) + letter + entry.name.slice(place + 1));

/** The name as the character's: the first three letters of its name. */
const characterName = (entry: NameEntry, character: string): void => void (entry.name = character.slice(0, LENGTH));

/** The name ended: its places from the cursor on spaces, the cursor past it, a refused name made the character's. */
function endName(entry: NameEntry, tables: NameTables, character: string): void {
  entry.name = entry.name.slice(0, entry.place).padEnd(LENGTH, SPACE);
  entry.place = LENGTH;
  if (tables.refused.includes(entry.name)) characterName(entry, character);
}

/**
 * A frame of the entry, `how` it takes it: from the pad (`pressed` the buttons newly pressed,
 * `repeats` those repeating while held), out of time, or cut short; `character` the holder's
 * character's name. Notes whether a letter was taken and whether the letter moved.
 */
export function stepNameEntry(entry: NameEntry, tables: NameTables, how: number, pressed: number, repeats: number, character: string): number {
  entry.took = 0;
  entry.moved = 0;
  if (how === NameStep.OUT_OF_TIME) {
    endName(entry, tables, character);
    return NameResult.ENDED;
  }
  if (how === NameStep.CUT_SHORT) {
    characterName(entry, character);
    entry.place = LENGTH;
    return NameResult.ENDED;
  }
  const step = ((repeats & RIGHT) !== 0 ? 1 : 0) - ((repeats & LEFT) !== 0 ? 1 : 0);
  if (step !== 0) entry.moved = 1;
  const last = tables.letters.length - 1;
  let letter = entry.letter + step;
  if (letter < 0) letter = last;
  else if (last < letter) letter = 0;
  entry.letter = letter;
  const place = entry.place;
  const shown = place < LENGTH ? tables.letters[letter]! : '';
  if (place < LENGTH) put(entry, place, shown);
  if ((pressed & BUTTONS) === 0) return NameResult.OPEN;
  entry.took = 1;
  if (shown === BACK) {
    if (place !== 0) {
      put(entry, place, SPACE);
      entry.place = place - 1;
    }
    return NameResult.OPEN;
  }
  if (shown === END) {
    endName(entry, tables, character);
    return NameResult.ENDED;
  }
  entry.place = place + 1;
  if (entry.place < LENGTH) return NameResult.OPEN;
  const secret = entry.name === tables.secret;
  endName(entry, tables, character);
  return secret ? NameResult.SECRET : NameResult.ENDED;
}
