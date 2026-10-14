/**
 * A song held back from the sound until the picture is ready for it: while `waiting`, each song a
 * field starts is taken out of its commands and kept in `held`; the first field that is not, the
 * held songs start first among its commands, or are dropped where the scene they were for is gone
 * (`fight` false).
 */
export function holdSongs<T extends { readonly key: string }>(commands: T[], held: T[], { waiting, fight }: { readonly waiting: boolean; readonly fight: boolean }): void {
  if (waiting) {
    for (let i = 0; i < commands.length; ) {
      if (commands[i]!.key === 'song') held.push(...commands.splice(i, 1));
      else i += 1;
    }
    return;
  }
  if (held.length === 0) return;
  if (fight) commands.unshift(...held);
  held.length = 0;
}
