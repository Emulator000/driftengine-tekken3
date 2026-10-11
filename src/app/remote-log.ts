/**
 * A page opened from another device under `npm run dev:lan` (a phone on the home network) tells the
 * machine serving it what it does: what it says on its console, its errors, and every two seconds
 * its state (its frames, its picture, its memory), posted to `/__log` and kept in
 * `.cache/client.log`. A tab the device shuts down leaves its last moments there.
 */

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
/** How often what was said is sent. */
const EVERY_MS = 2000;
/** The longest line kept. */
const LINE_CHARACTERS = 2000;

interface HeapMemory {
  readonly usedJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

/** What else each state line carries. */
const states: (() => string)[] = [];

/** Whether this page tells its machine what it does: served by `dev:lan`, open on another device. */
export const remote = import.meta.env.MODE === 'lan' && !LOCAL.has(location.hostname);

/** Have every state line carry `line()` too. */
export function tellWith(line: () => string): void {
  states.push(line);
}

/** Start telling, where the page runs on another device. */
export function remoteLog(): void {
  if (!remote) return;
  const started = performance.now();
  let lines: string[] = [];
  const say = (kind: string, text: string): void => {
    lines.push(`${((performance.now() - started) / 1000).toFixed(1)}s ${kind} ${text.replace(/\s+/g, ' ').slice(0, LINE_CHARACTERS)}`);
  };
  const send = (): void => {
    if (lines.length === 0) return;
    const body = lines.join('\n');
    lines = [];
    if (!navigator.sendBeacon?.('/__log', body)) void fetch('/__log', { method: 'POST', body, keepalive: true }).catch(() => {});
  };
  for (const kind of ['log', 'warn', 'error'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => {
      original(...args);
      say(kind, args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : typeof a === 'string' ? a : json(a))).join(' '));
    };
  }
  addEventListener('error', (e) => say('uncaught', `${e.message} at ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => say('rejected', String((e.reason as Error | undefined)?.stack ?? e.reason)));
  addEventListener('pagehide', send);
  const hints = navigator as Navigator & { deviceMemory?: number };
  say('device', `${navigator.userAgent} | memory ${hints.deviceMemory ?? '?'} GB | screen ${screen.width}x${screen.height} @${devicePixelRatio} | gpu ${'gpu' in navigator ? 'yes' : 'no'}`);
  setInterval(() => {
    const heap = (performance as Performance & { memory?: HeapMemory }).memory;
    const parts = heap === undefined ? [] : [`heap ${mb(heap.usedJSHeapSize)} of ${mb(heap.jsHeapSizeLimit)} MB`];
    say('state', [...parts, ...states.map((s) => s())].join(' | '));
    send();
  }, EVERY_MS);
}

function mb(bytes: number): string {
  return (bytes / 2 ** 20).toFixed(0);
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
