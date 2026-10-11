/**
 * Where the frames' time goes, over the last two seconds of frames drawn: how many fields ran and
 * frames were drawn a second, and how many frames drawn ran two fields (a picture skipped), the
 * time between frames drawn (median and longest), and the main thread's time on the fields and on
 * the drawing. A page on another device tells it in its state lines (`remote-log.ts`).
 */

/** Frames drawn the figures are taken over. */
const KEEP = 120;

export class FrameStats {
  private readonly intervals: number[] = [];
  private readonly fields: number[] = [];
  private readonly draws: number[] = [];
  private lastDrawn = 0;
  private fieldMs = 0;
  /** Fields run since the last frame drawn. */
  private fieldsSince = 0;
  private drawStart = 0;
  /** Fields run, frames drawn and frames drawn after two fields since `since`. */
  private counts = { fields: 0, drawn: 0, doubled: 0, since: performance.now() };
  private rates = { fields: 0, drawn: 0, doubled: 0 };

  constructor(private readonly describe: () => string) {}

  /** A field ran from `start` (`performance.now()`) to now. */
  field(start: number): void {
    this.fieldMs += performance.now() - start;
    this.fieldsSince += 1;
    this.counts.fields += 1;
  }

  /** A frame's drawing begins. */
  drawing(): void {
    this.drawStart = performance.now();
  }

  /** The frame is drawn. */
  drawn(): void {
    const now = performance.now();
    if (this.lastDrawn > 0) {
      keep(this.intervals, now - this.lastDrawn);
      keep(this.fields, this.fieldMs);
      keep(this.draws, now - this.drawStart);
    }
    this.lastDrawn = now;
    this.fieldMs = 0;
    this.counts.drawn += 1;
    if (this.fieldsSince > 1) this.counts.doubled += 1;
    this.fieldsSince = 0;
    const span = now - this.counts.since;
    if (span >= 1000) {
      const { fields, drawn, doubled } = this.counts;
      this.rates = { fields: (fields * 1000) / span, drawn: (drawn * 1000) / span, doubled: (doubled * 1000) / span };
      this.counts = { fields: 0, drawn: 0, doubled: 0, since: now };
    }
  }

  /** The figures as one line: rates, frame times, the main thread's, and what draws. */
  line(): string {
    const ms = (list: readonly number[]): string => (list.length === 0 ? '-' : `${median(list).toFixed(1)}`);
    return [
      `${this.rates.fields.toFixed(0)} fields/s, ${this.rates.drawn.toFixed(0)} frames/s, ${this.rates.doubled.toFixed(0)}/s doubled`,
      `frame ${ms(this.intervals)} ms, longest ${this.intervals.length === 0 ? '-' : Math.max(...this.intervals).toFixed(1)}`,
      `cpu: fields ${ms(this.fields)} ms, draw ${ms(this.draws)} ms`,
      this.describe(),
    ].join(' | ');
  }
}

function keep(list: number[], value: number): void {
  list.push(value);
  if (list.length > KEEP) list.shift();
}

function median(list: readonly number[]): number {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}
