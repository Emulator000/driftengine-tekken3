/**
 * One side of an online match: both machines run the same game from the same start, each stepping it
 * a field at a time from both pads' words, its own the moment it is pressed (after the input delay)
 * and the other's as it arrives, guessed until then. A word that arrives for a field already played
 * rolls the game back to that field and plays it forward again to the present, within the frame.
 *
 * The rollback, the input log and the comparison of the two games are the engine's
 * (`@driftengine/network`); this is how the game uses them:
 *
 * - The other pad's word is guessed as the last one it sent: a pad held is usually held still.
 * - The game rolls back at most `ROLLBACK_DEPTH` fields. A word later than that stops this side
 *   (a stall) until it arrives, rather than leaving a field played on a guess it can no longer put
 *   right; five seconds of it with nothing heard from the other side ends the match as a
 *   disconnection (a side loading its fight says so, `heard`).
 * - A field's word is taken as the field is played, and sent once. The pad's changes while this
 *   side waits are kept in order and played one a field after it, so a tap then is not lost and two
 *   presses are never played as one (two buttons together make another move, a throw of two
 *   strikes). While this side waits (or leaves a field out)
 *   it sends its last packet again as it was, the words before it with it, so the other side gets
 *   any it lacks, and never a second word for a field it may have played already.
 * - Each side tells the other how far ahead of it it reckons itself (with the round trip's
 *   measures); the one further ahead than the other leaves out a field now and then, so both play
 *   at the same time rather than one stalling on the other again and again. Both reckon alike, so
 *   whatever their reckoning shares cancels out.
 * - The two games' fingerprints are compared every few fields, at a field both pads' words are in
 *   for (the newest ones are each side's own guesses, and differ rightly); a difference halts the
 *   match and names the field.
 */
import { InputLog, LockstepSession, MESSAGE_INPUT, RewindLoop, repeatLastInput } from '@driftengine/network';
import type { Desync, MessageSink, PeerId, Snapshotter, Transport, TransportState } from '@driftengine/network';

import { INPUT_BYTES, REDUNDANCY, readWord, writeWord } from './wire.ts';

/** A field's length, in seconds. */
export const FIELD = 1 / 60;
/** The fields a late word can roll the game back. */
export const ROLLBACK_DEPTH = 8;
/** The input delay asked for by default, and the most: the larger of both players' is the match's. */
export const DEFAULT_INPUT_DELAY = 2;
export const MAX_INPUT_DELAY = 6;
/** Fields of waiting that make a disconnection: five seconds. */
export const STALL_DISCONNECT = 300;
/** Fields the input log holds: the rollback window, the delay ahead and a burst. */
const LOG_DEPTH = 64;
/** Fields between the fingerprints the two sides compare. */
const FINGERPRINT_EVERY = 8;
/** How much further ahead than the other side this one must reckon itself to leave a field out, and how often at most. */
const LEAD = 2;
const SKIP_EVERY = 6;
/** The most changes of the pad kept while no field is played; past them the newest takes the last one's place. */
const MOST_WAITING = 8;

export type SessionState = 'running' | 'stalled' | 'desynced' | 'disconnected' | 'halted';

/** How the match is going, as a player is shown it. */
export interface ConnectionQuality {
  readonly roundTripMs: number;
  readonly inputDelay: number;
  /** Rollbacks so far, the fields they played again, and the most in one. */
  readonly rollbacks: number;
  readonly rolledBack: number;
  readonly deepest: number;
  /** Stalls so far, and the fields spent in them; fields left out to keep time with the other side. */
  readonly stalls: number;
  readonly stalledFields: number;
  readonly skipped: number;
  /** Whether the words go through the server rather than straight between the two. */
  readonly relayed: boolean;
}

export interface SessionOptions<S> {
  /** One field of the game, from both pads' words; the field's number. */
  readonly step: (words: readonly [number, number], field: number) => void;
  /** The game's state, saved and restored whole. */
  readonly snapshotter: Snapshotter<S>;
  readonly transport: Transport;
  /** This side's seat: 0 the first pad, 1 the second. */
  readonly self: PeerId;
  /** Both players' input delay, in fields; the larger is used. */
  readonly inputDelay: readonly [number, number];
  readonly relayed?: boolean;
  /**
   * The match's number, the same on both sides and another for each match the two play on one link:
   * its packets carry it, and a packet of another match (the last one's, still arriving, or sent
   * again as it ended) is passed over.
   */
  readonly match?: number;
}

export class MatchSession<S> {
  readonly self: PeerId;
  readonly inputDelay: number;
  private readonly stepOne: (words: readonly [number, number], field: number) => void;
  private readonly loop: RewindLoop<S>;
  private readonly inputs: InputLog;
  private readonly session: LockstepSession<S>;
  private readonly transport: KeepingTransport;
  /** The pad's words while no field was played (each one a change from the word before it), played one a field in turn; and the last word played. */
  private readonly waiting: number[] = [];
  private lastWord = 0;
  /** How far ahead the other side last reckoned itself, or null before it said. */
  private theirs: number | null = null;
  private readonly payload = new Uint8Array(INPUT_BYTES);
  private readonly words: [Uint8Array, Uint8Array] = [new Uint8Array(INPUT_BYTES), new Uint8Array(INPUT_BYTES)];
  private readonly both: [number, number] = [0, 0];
  private field = 0;
  private stateNow: SessionState = 'running';
  private stallRun = 0;
  /** Fields of the stall since the other side was last heard. */
  private quiet = 0;
  private skipped = 0;
  private lastSkip = 0;
  private stalls = 0;
  private stalledFields = 0;
  private relayed: boolean;
  private roundTrip = 0;
  private deepest = 0;

  constructor(options: SessionOptions<S>) {
    this.self = options.self;
    this.stepOne = options.step;
    this.relayed = options.relayed ?? true;
    this.inputDelay = clampDelay(Math.max(options.inputDelay[0], options.inputDelay[1]));
    this.inputs = new InputLog({ participants: 2, depth: LOG_DEPTH, inputBytes: INPUT_BYTES, predict: repeatLastInput });
    this.loop = new RewindLoop<S>({
      step: (_dt, tick) => this.step(tick),
      snapshotter: options.snapshotter,
      inputs: this.inputs,
      fixedDt: FIELD,
      depth: ROLLBACK_DEPTH,
    });
    this.transport = new KeepingTransport(new MatchTransport(options.transport, options.match ?? 0));
    this.session = new LockstepSession<S>({
      transport: this.transport,
      loop: this.loop,
      inputs: this.inputs,
      self: options.self,
      participants: 2,
      inputDelay: this.inputDelay,
      redundancy: REDUNDANCY,
      compareStates: true,
      fingerprintEvery: FINGERPRINT_EVERY,
    });
  }

  get state(): SessionState {
    return this.stateNow;
  }

  /** The field this side has played up to. */
  get tick(): number {
    return this.field;
  }

  /** How many fields this side has waited for the other in this stall. */
  get stalling(): number {
    return this.stallRun;
  }

  get desync(): Desync | null {
    return this.session.desync;
  }

  /** Why the match halted, or the empty string. */
  get reason(): string {
    return this.session.reason;
  }

  /** The words now go straight between the two. */
  wentDirect(): void {
    this.relayed = false;
  }

  /** The round trip as measured, in milliseconds. */
  measured(roundTripMs: number): void {
    this.roundTrip = roundTripMs;
  }

  /** The last words sent, sent again: the match over on this side, the other's may still need them. */
  sendAgain(): void {
    this.transport.sendAgain();
  }

  /** The other side was heard from (it is loading, or waiting itself): its silence is not a disconnection yet. */
  heard(): void {
    this.quiet = 0;
  }

  /** The other side's own reckoning of how far ahead it is (`ahead`), as it said. */
  theirLead(ahead: number): void {
    if (Number.isFinite(ahead)) this.theirs = ahead;
  }

  /** How many fields this side is ahead of the other, by the newest word heard and half the round trip; 0 before a round trip is measured. */
  get ahead(): number {
    if (this.roundTrip <= 0) return 0;
    const other = this.self === 0 ? 1 : 0;
    let newest = -1;
    for (let at = this.inputs.windowEnd - 1; at >= this.inputs.windowStart; at -= 1) {
      if (this.inputs.isConfirmed(other, at)) {
        newest = at;
        break;
      }
    }
    if (newest < this.inputDelay) return 0;
    return this.field - (newest - this.inputDelay) - Math.round(this.roundTrip / 2 / (FIELD * 1000));
  }

  /** Halts the match, as when this side leaves it. */
  halt(reason: string): void {
    this.session.halt(reason);
    this.stateNow = 'halted';
  }

  /**
   * One frame of this side: its pad's word sent, the other's taken as it has arrived, and a field
   * played if it can be without leaving a guess past the rollback window (else this side waits).
   * Whether a field was played.
   */
  advance(word: number): boolean {
    if (this.stateNow === 'desynced' || this.stateNow === 'disconnected' || this.stateNow === 'halted') return false;
    /* A change of the pad's kept: played in its turn, never merged with another (two presses would make a third move). */
    const newest = this.waiting.length > 0 ? this.waiting[this.waiting.length - 1]! : this.lastWord;
    if (word !== newest) {
      if (this.waiting.length < MOST_WAITING) this.waiting.push(word);
      else this.waiting[MOST_WAITING - 1] = word;
    }
    this.session.poll();
    if (this.session.status === 'halted') {
      this.stateNow = this.session.desync === null ? 'halted' : 'desynced';
      return false;
    }
    /* The field about to leave the rollback window must have both pads' own words, or it could no longer be put right. */
    const edge = this.field - ROLLBACK_DEPTH;
    if (edge >= this.inputDelay && !this.inputs.isComplete(edge)) {
      if (this.stallRun === 0) this.stalls += 1;
      this.stallRun += 1;
      this.quiet += 1;
      this.stalledFields += 1;
      this.stateNow = this.quiet >= STALL_DISCONNECT ? 'disconnected' : 'stalled';
      this.transport.sendAgain();
      return false;
    }
    this.stallRun = 0;
    this.quiet = 0;
    if (this.theirs !== null && LEAD <= this.ahead - this.theirs && SKIP_EVERY <= this.field - this.lastSkip) {
      this.lastSkip = this.field;
      this.skipped += 1;
      this.transport.sendAgain();
      return false;
    }
    const played = this.waiting.shift() ?? word;
    this.lastWord = played;
    writeWord(this.payload, played);
    this.session.submit(this.field, this.payload);
    this.stateNow = 'running';
    const before = this.loop.stats.replayedTicks;
    this.session.advance(FIELD, this.field);
    this.deepest = Math.max(this.deepest, this.loop.stats.replayedTicks - before);
    this.field += 1;
    return true;
  }

  get quality(): ConnectionQuality {
    const stats = this.loop.stats;
    return {
      roundTripMs: this.roundTrip,
      inputDelay: this.inputDelay,
      rollbacks: stats.replays,
      rolledBack: stats.replayedTicks,
      deepest: this.deepest,
      stalls: this.stalls,
      stalledFields: this.stalledFields,
      skipped: this.skipped,
      relayed: this.relayed,
    };
  }

  /** One field, from the words the log holds for it (its own, or the guess). */
  private step(tick: number): void {
    this.inputs.into(0, tick, this.words[0]);
    this.inputs.into(1, tick, this.words[1]);
    this.both[0] = readWord(this.words[0]);
    this.both[1] = readWord(this.words[1]);
    this.stepOne(this.both, tick);
  }
}

function clampDelay(fields: number): number {
  if (!Number.isFinite(fields)) return DEFAULT_INPUT_DELAY;
  return Math.max(0, Math.min(MAX_INPUT_DELAY, Math.trunc(fields)));
}

/** A transport whose packets each carry the match's number first, those of another match passed over. */
class MatchTransport implements Transport {
  private readonly inner: Transport;
  private readonly match: number;

  constructor(inner: Transport, match: number) {
    this.inner = inner;
    this.match = match & 0xff;
  }

  get state(): TransportState {
    return this.inner.state;
  }

  get self(): PeerId {
    return this.inner.self;
  }

  send(to: PeerId, message: Uint8Array): void {
    const out = new Uint8Array(message.length + 1);
    out[0] = this.match;
    out.set(message, 1);
    this.inner.send(to, out);
  }

  drain(into: MessageSink): void {
    this.inner.drain((from, message) => {
      if (message.length > 1 && message[0] === this.match) into(from, message.subarray(1));
    });
  }

  close(): void {
    this.inner.close();
  }
}

/** A transport that keeps the last packet of words it sent, to send it again as it was. */
class KeepingTransport implements Transport {
  private readonly inner: Transport;
  private last: Uint8Array = new Uint8Array(0);
  private to: PeerId = 0;

  constructor(inner: Transport) {
    this.inner = inner;
  }

  get state(): TransportState {
    return this.inner.state;
  }

  get self(): PeerId {
    return this.inner.self;
  }

  send(to: PeerId, message: Uint8Array): void {
    if (message[0] === MESSAGE_INPUT) {
      if (this.last.length !== message.length) this.last = new Uint8Array(message.length);
      this.last.set(message);
      this.to = to;
    }
    this.inner.send(to, message);
  }

  /** The last packet of words again, if one was sent. */
  sendAgain(): void {
    if (this.last.length > 0) this.inner.send(this.to, this.last);
  }

  drain(into: MessageSink): void {
    this.inner.drain(into);
  }

  close(): void {
    this.inner.close();
  }
}
