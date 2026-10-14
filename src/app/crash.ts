/**
 * The page's stop, shown as the game's own: a window over the held picture saying the game stopped,
 * what went wrong and where, and what was playing (the version, the scene or match, the fighters,
 * the stage, the field, the renderer), laid out to be read in a screenshot. Its details copy to
 * the clipboard for a report, and the page starts again from it. A failure while loading, drawing
 * or stepping the game shows it, and only the first is shown.
 */
import pkg from '../../package.json';

const ISSUES = 'https://github.com/Emulator000/driftengine-tekken3/issues';
/** The stack's frames shown, from the top. */
const FRAMES = 8;

/** What the page knows of the game when it stops, added to the details. */
let describe: () => Record<string, unknown> = () => ({});
let shown = false;

/** Where the details of the game playing come from, once it plays. */
export function crashDetails(source: () => Record<string, unknown>): void {
  describe = source;
}

/** A stack's frames as `function (file:line)`, the page's own address left off. */
function framesOf(error: unknown): string[] {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') || /@/.test(line))
    .slice(0, FRAMES)
    .map((line) => line.replace(/^at /, '').replace(location.origin, '').replace(/\?[^:)]*/g, ''));
}

/** A value for the details: a short line, its objects as JSON. */
function shortly(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The game stopped: its window shown over the picture, once. */
export function showCrash(error: unknown, during: string): void {
  if (shown) return;
  shown = true;
  const message = error instanceof Error ? error.message : String(error);
  let game: Record<string, unknown> = {};
  try {
    game = describe();
  } catch {
    /* The game's own state may be what broke: the stop is shown without it. */
  }
  const details: [string, string][] = [
    ['Version', pkg.version],
    ['While', during],
    ...Object.entries(game)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]): [string, string] => [k, shortly(v)]),
    ['Address', location.search || '(none)'],
    ['Browser', navigator.userAgent],
  ];
  const frames = framesOf(error);
  const text = [`Tekken 3 remake ${pkg.version}: the game stopped`, message, '', ...frames.map((f) => `  at ${f}`), '', ...details.map(([k, v]) => `${k}: ${v}`)].join('\n');
  console.error('[tekken3 remake] the game stopped:', error);

  const style = document.createElement('style');
  style.textContent = `
    .crash { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px;
      background: rgba(0, 0, 0, 0.62); user-select: text; -webkit-user-select: text; }
    .crash-window { width: min(760px, 100%); max-height: calc(100% - 32px); overflow: auto; box-sizing: border-box;
      background: linear-gradient(180deg, rgba(22, 26, 44, 0.97), rgba(8, 10, 18, 0.97));
      border: 2px solid #8b93a8; border-radius: 6px; box-shadow: 0 0 0 1px #000, 0 18px 60px rgba(0, 0, 0, 0.7);
      color: #e8ebf2; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .crash-title { margin: 0; padding: 12px 18px; font: 800 22px/1.2 system-ui, sans-serif; letter-spacing: 0.08em;
      text-transform: uppercase; color: #fff; text-shadow: 0 2px 0 #000;
      background: linear-gradient(180deg, #c8102e, #7a0a1c); border-bottom: 2px solid #8b93a8; }
    .crash-body { padding: 14px 18px 16px; }
    .crash-message { margin: 0 0 10px; font-weight: 700; font-size: 15px; color: #ffd36b; white-space: pre-wrap; word-break: break-word; }
    .crash-frames { margin: 0 0 12px; padding: 8px 10px; background: rgba(0, 0, 0, 0.45); border-left: 3px solid #c8102e;
      white-space: pre-wrap; word-break: break-all; color: #b9c0d0; font-size: 12px; }
    .crash-details { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 0 0 14px; }
    .crash-details dt { color: #8b93a8; }
    .crash-details dd { margin: 0; word-break: break-word; }
    .crash-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .crash-actions button { font: 700 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 4px; cursor: pointer;
      color: #fff; background: #2a3150; border: 1px solid #8b93a8; }
    .crash-actions button:hover { background: #3a4470; }
    .crash-hint { color: #8b93a8; font-size: 12px; }`;
  const root = document.createElement('div');
  root.className = 'crash';
  root.setAttribute('role', 'alertdialog');
  root.innerHTML = `
    <section class="crash-window">
      <h1 class="crash-title">The game stopped</h1>
      <div class="crash-body">
        <p class="crash-message"></p>
        <pre class="crash-frames"></pre>
        <dl class="crash-details"></dl>
        <div class="crash-actions">
          <button type="button" data-act="copy">Copy details</button>
          <button type="button" data-act="reload">Start again</button>
          <span class="crash-hint"></span>
        </div>
      </div>
    </section>`;
  root.querySelector('.crash-message')!.textContent = message;
  root.querySelector('.crash-frames')!.textContent = frames.length > 0 ? frames.join('\n') : '(no stack)';
  const list = root.querySelector('.crash-details')!;
  for (const [k, v] of details) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    list.append(dt, dd);
  }
  const hint = root.querySelector<HTMLElement>('.crash-hint')!;
  hint.textContent = `A screenshot of this, or its details, helps: ${ISSUES}`;
  root.querySelector<HTMLButtonElement>('[data-act="copy"]')!.addEventListener('click', () => {
    void navigator.clipboard?.writeText(text).then(
      () => (hint.textContent = 'Details copied.'),
      () => (hint.textContent = 'The browser would not copy: select the text above instead.'),
    );
  });
  root.querySelector<HTMLButtonElement>('[data-act="reload"]')!.addEventListener('click', () => location.reload());
  /* The game's keys stop reaching the page under the window. */
  root.addEventListener('keydown', (e) => e.stopPropagation());
  document.head.append(style);
  document.body.append(root);
  document.querySelector<HTMLElement>('#status')?.replaceChildren();
}

/** Failures nothing caught (a load, a module, a promise) shown as the game's stop. */
export function catchUncaught(): void {
  addEventListener('error', (e) => showCrash(e.error ?? e.message, 'running the page'));
  addEventListener('unhandledrejection', (e) => showCrash(e.reason, 'loading the game'));
}
