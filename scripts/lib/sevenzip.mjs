/**
 * 7-Zip, for the images given as `.7z` archives: `SEVEN_ZIP` when set, else the first of its usual
 * command names on the path (`7z`, `7zz` as Homebrew and the official macOS and Linux builds name
 * it, `7za`), else its usual install folders on Windows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const windowsFolders = () =>
  [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter((dir) => dir !== undefined)
    .map((dir) => path.join(dir, '7-Zip', '7z.exe'));

const runs = (command) => spawnSync(command, ['i'], { stdio: 'ignore' }).error === undefined;

let found;

/** The 7-Zip command to run, or an error saying how to install it. */
export function sevenZip() {
  if (found !== undefined) return found;
  const candidates = [process.env.SEVEN_ZIP, '7z', '7zz', '7za', ...(process.platform === 'win32' ? windowsFolders() : [])];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue;
    if (path.isAbsolute(candidate) ? existsSync(candidate) : runs(candidate)) return (found = candidate);
  }
  throw new Error(
    'a .7z image needs 7-Zip: install it (Windows: winget install 7zip.7zip; macOS: brew install sevenzip; ' +
      'Linux: your distribution\'s 7zip or p7zip package), set SEVEN_ZIP to its program, or give the .bin and .cue instead',
  );
}

/** Extracts `archive` (or only `members` of it) into `dir`. */
export function extract7z(archive, dir, members = [], stdio = 'ignore') {
  const result = spawnSync(sevenZip(), ['x', '-y', `-o${dir}`, archive, ...members], { stdio });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`7-Zip could not extract ${archive} (exit ${result.status})`);
}
