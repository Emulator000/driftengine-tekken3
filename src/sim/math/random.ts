/**
 * The game's random numbers: the C library's linear congruential generator (a 32-bit state, each
 * draw its upper 15 bits), and a draw below a bound, which mixes in a second generator stepped by
 * five times itself plus three.
 */
export class Random {
  state: number;
  mix: number;

  constructor(state = 0, mix = 0) {
    this.state = state >>> 0;
    this.mix = mix >>> 0;
  }

  /** 0 to 0x7fff. */
  next(): number {
    this.state = (Math.imul(this.state, 0x41c64e6d) + 0x3039) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** 0 to `n` less one. */
  below(n: number): number {
    const v = Math.imul(n, (this.next() + this.mix) & 0x7fff);
    this.mix = (Math.imul(this.mix, 5) + 3) >>> 0;
    return (v < 0 ? v + 0x7fff : v) >> 15;
  }
}

/** The generators' state as the fight keeps it. */
export interface RandomState {
  state: number;
  mix: number;
}

/** 0 to 0x7fff, from the state as the fight keeps it. */
export function nextRandom(r: RandomState): number {
  r.state = (Math.imul(r.state, 0x41c64e6d) + 0x3039) >>> 0;
  return (r.state >>> 16) & 0x7fff;
}

/** 0 to `n` less one, from the state as the fight keeps it. */
export function randomBelow(r: RandomState, n: number): number {
  const v = Math.imul(n, (nextRandom(r) + r.mix) & 0x7fff);
  r.mix = (Math.imul(r.mix, 5) + 3) >>> 0;
  return (v < 0 ? v + 0x7fff : v) >> 15;
}
