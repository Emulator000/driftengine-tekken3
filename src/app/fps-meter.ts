/**
 * The frame rate in the window's top right corner, shown and hidden with `F`: the frames the page
 * showed over the last second (each one drawn, or kept where nothing in it changed), their mean
 * time and the longest of them. Whether it shows is kept in the browser for next time.
 */

const KEY = 'tekken3.fps';
/** How often the reading changes, milliseconds. */
const REFRESH = 500;
/** The frames it is taken over, milliseconds back. */
const WINDOW = 1000;

export class FpsMeter {
  private readonly box = document.createElement('div');
  private readonly times: number[] = [];
  private shown = false;
  private written = 0;

  constructor() {
    Object.assign(this.box.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: '1000',
      padding: '4px 8px',
      font: '600 13px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      color: '#e8f4ee',
      background: 'rgba(0, 0, 0, 0.55)',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      display: 'none',
    });
    document.body.append(this.box);
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      this.show(!this.shown);
    });
    let remembered = false;
    try {
      remembered = localStorage.getItem(KEY) === '1';
    } catch {
      /* Hidden. */
    }
    if (remembered) this.show(true);
  }

  /** A frame shown at `now` (`performance.now()`). */
  frame(now: number): void {
    if (!this.shown) return;
    const times = this.times;
    times.push(now);
    while (times.length > 0 && now - times[0]! > WINDOW) times.shift();
    if (now - this.written < REFRESH || times.length < 2) return;
    this.written = now;
    let longest = 0;
    for (let i = 1; i < times.length; i += 1) longest = Math.max(longest, times[i]! - times[i - 1]!);
    const mean = (times[times.length - 1]! - times[0]!) / (times.length - 1);
    this.box.textContent = `${Math.round(1000 / mean)} FPS  ${mean.toFixed(1)} ms  max ${longest.toFixed(1)}`;
  }

  private show(on: boolean): void {
    this.shown = on;
    this.box.style.display = on ? 'block' : 'none';
    this.times.length = 0;
    this.written = 0;
    this.box.textContent = '-- FPS';
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* A browser that keeps nothing starts with it hidden. */
    }
  }
}
