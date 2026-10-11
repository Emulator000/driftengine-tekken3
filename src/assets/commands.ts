/**
 * Each model pack's command list (`tables/commands.json`), validated: its moves, each a name and a
 * command as tokens: a run of text, a direction on the pad (a numpad digit, 5 neutral, and whether
 * it is held), a set of buttons (1 to 4), a circled number, a wide gap (what follows goes to the
 * line's end) or a new line.
 */
import { AssetError, expectArray, expectBoolean, expectInt, expectObject } from './validate.ts';

export type CommandToken =
  | string
  | { readonly dir: number; readonly held: boolean }
  | { readonly buttons: readonly number[] }
  | { readonly badge: number }
  | { readonly gap: true }
  | { readonly line: true };

export interface CommandMove {
  readonly name: readonly CommandToken[];
  readonly command: readonly CommandToken[];
}

export interface CommandTables {
  /** By model pack. */
  readonly lists: ReadonlyMap<number, readonly CommandMove[]>;
}

function token(value: unknown, where: string): CommandToken {
  if (typeof value === 'string') return value;
  const o = expectObject(value, where);
  if ('dir' in o) return { dir: expectInt(o.dir, `${where}.dir`, 1, 9), held: expectBoolean(o.held, `${where}.held`) };
  if ('buttons' in o) return { buttons: expectArray(o.buttons, `${where}.buttons`).map((b, i) => expectInt(b, `${where}.buttons[${i}]`, 1, 4)) };
  if ('badge' in o) return { badge: expectInt(o.badge, `${where}.badge`, 1, 9) };
  if (o.gap === true) return { gap: true };
  if (o.line === true) return { line: true };
  throw new AssetError(where, 'is no command token');
}

const tokens = (value: unknown, where: string): CommandToken[] => expectArray(value, where).map((t, i) => token(t, `${where}[${i}]`));

export function parseCommandTables(json: unknown, where = 'tables/commands.json'): CommandTables {
  const lists = expectObject(expectObject(json, where).lists, `${where} lists`);
  return {
    lists: new Map(
      Object.entries(lists).map(([pack, moves]) => {
        const at = `${where} lists.${pack}`;
        return [
          expectInt(Number(pack), `${at} (its pack)`, 0, 0xff),
          expectArray(moves, at).map((m, i) => {
            const move = expectObject(m, `${at}[${i}]`);
            return { name: tokens(move.name, `${at}[${i}].name`), command: tokens(move.command, `${at}[${i}].command`) };
          }),
        ];
      }),
    ),
  };
}
