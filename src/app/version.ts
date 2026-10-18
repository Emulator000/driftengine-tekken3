/**
 * The mode menu's corner: the game's version, and a notice where the repository has tagged a
 * newer one. The page asks GitHub's public API for the repository's tags, without a word about the
 * player, at most every `KEEP_HOURS`, and keeps the newest on the device; where GitHub does not
 * answer, the newest kept stands, and with none the corner shows the version alone.
 */

/** The repository's tags, as GitHub's API lists them. */
const TAGS = 'https://api.github.com/repos/Emulator000/driftengine-tekken3/tags?per_page=100';
/** Where the newest version is kept, and for how long it stands before GitHub is asked again. */
const KEPT = 'tekken3.newest';
export const KEEP_HOURS = 6;
/** How long GitHub is given to answer. */
const PATIENCE_MS = 8000;
/** A tag that names a release: `v` and three numbers. */
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

const numbers = (version: string): number[] => version.split('.').map(Number);

/** Whether `version` is higher than `than`, each three numbers compared in turn. */
export function isNewer(version: string, than: string): boolean {
  const [a, b] = [numbers(version), numbers(than)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** The highest version among tags named `vX.Y.Z` (without its `v`); null where none is. */
export function newestTag(names: readonly string[]): string | null {
  let newest: string | null = null;
  for (const name of names) {
    const match = RELEASE.exec(name);
    if (match === null) continue;
    const version = match.slice(1).join('.');
    if (newest === null || isNewer(version, newest)) newest = version;
  }
  return newest;
}

/** The corner's two parts: the game's version, and the notice where `newest` is higher (else empty). */
export function menuCorner(own: string, newest: string | null): { version: string; notice: string } {
  return { version: own, notice: newest !== null && isNewer(newest, own) ? '(NEW VERSION AVAILABLE!)' : '' };
}

/** What the check reaches: the clock, the device's storage and the network. */
export interface VersionIo {
  now(): number;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  fetch(url: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'json'>>;
}

/** The newest version tagged: the one kept where it is fresh, else GitHub's answer (kept), else the one kept however old; null with none. Never throws. */
export async function newestVersion(io: VersionIo): Promise<string | null> {
  let kept: { newest: string; at: number } | null = null;
  try {
    const read = JSON.parse(io.storage.getItem(KEPT) ?? 'null') as unknown;
    if (typeof read === 'object' && read !== null && typeof (read as { newest?: unknown }).newest === 'string' && typeof (read as { at?: unknown }).at === 'number') kept = read as { newest: string; at: number };
  } catch {
    /* Nothing kept, or a storage the page may not use. */
  }
  if (kept !== null && io.now() - kept.at < KEEP_HOURS * 3600 * 1000) return kept.newest;
  try {
    const answer = await io.fetch(TAGS, { signal: AbortSignal.timeout(PATIENCE_MS) });
    if (!answer.ok) return kept?.newest ?? null;
    const tags = (await answer.json()) as { name?: unknown }[];
    const newest = newestTag(tags.map((tag) => (typeof tag.name === 'string' ? tag.name : '')));
    if (newest === null) return kept?.newest ?? null;
    try {
      io.storage.setItem(KEPT, JSON.stringify({ newest, at: io.now() }));
    } catch {
      /* A storage the page may not use: asked again next time. */
    }
    return newest;
  } catch {
    return kept?.newest ?? null;
  }
}
