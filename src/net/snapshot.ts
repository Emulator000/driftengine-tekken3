/**
 * The game's state saved and restored whole, for an online match's rollback: every number, string
 * and switch of it, copied into a slot made once and kept, and copied back into the live state in
 * place, so whatever holds a part of it (a scene's module, the presentation) holds it still.
 *
 * The state is a tree of plain objects, arrays and typed arrays. Some of its fields hold a part of
 * the loaded data (a fighter's move, a hit's reaction): those are the data's, never the state's, so
 * they are told to the snapshotter (`share`) and copied as references, never into. A slot is
 * allocated as it is first filled and reused after, growing only where a list in the state does.
 */
import type { Snapshotter } from '@driftengine/network';

type Tree = Record<string, unknown> | unknown[];

/** FNV-1a's 32-bit offset and prime, for the fingerprint's low half; the high half's own. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HIGH_OFFSET = 0x9e3779b9;
const HIGH_PRIME = 0x5bd1e995;

/** A number's two 32-bit halves, for the fingerprint. */
const NUMBER = new Float64Array(1);
const HALVES = new Uint32Array(NUMBER.buffer);

export class StateSnapshotter<T extends object> implements Snapshotter<Tree> {
  private readonly state: T;
  /** The loaded data's objects: copied as references. */
  private readonly shared = new WeakSet<object>();
  /** The state's fields, by name at its root, left out of the fingerprint: this machine's own (its settings), which never decide anything. */
  private readonly own: ReadonlySet<string>;
  /** The fingerprint's two halves while it is made. */
  private low = FNV_OFFSET;
  private high = HIGH_OFFSET;

  constructor(state: T, own: readonly string[] = []) {
    this.state = state;
    this.own = new Set(own);
  }

  /** Every object of `data` (a match's loaded data, the game's tables) marked as the data's, so the state's references to it are copied as they are. */
  share(data: object): void {
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== 'object' || this.shared.has(v)) return;
      this.shared.add(v);
      if (ArrayBuffer.isView(v)) return;
      if (Array.isArray(v)) for (const item of v) walk(item);
      else for (const key in v) walk((v as Record<string, unknown>)[key]);
    };
    walk(data);
  }

  create(): Tree {
    return {};
  }

  save(into: Tree): void {
    this.copy(into, this.state as Tree);
  }

  restore(from: Tree): void {
    this.copy(this.state as Tree, from);
  }

  /** The fingerprint the two sides compare: 64 bits, as 16 hex digits. */
  digest(from: Tree): string {
    this.low = FNV_OFFSET;
    this.high = HIGH_OFFSET;
    this.hash(from, true);
    return hex(this.high) + hex(this.low);
  }

  /** The live state's fingerprint, as `digest` would give it of a slot saved now. */
  digestNow(): string {
    return this.digest(this.state as Tree);
  }

  /** Each of `from`'s fields onto `to`, into `to`'s own objects and arrays where they are the state's. */
  private copy(to: Tree, from: Tree): void {
    if (Array.isArray(from)) {
      const into = to as unknown[];
      if (into.length !== from.length) into.length = from.length;
      for (let i = 0; i < from.length; i += 1) into[i] = this.put(into[i], from[i]);
      return;
    }
    const into = to as Record<string, unknown>;
    for (const key in from) into[key] = this.put(into[key], from[key]);
  }

  /** `value` as the field holding `held` should hold it: itself if it is plain or the data's, else copied into `held` (or a new object where `held` cannot take it). */
  private put(held: unknown, value: unknown): unknown {
    if (value === null || typeof value !== 'object' || this.shared.has(value)) return value;
    if (ArrayBuffer.isView(value)) {
      const typed = value as unknown as Uint8Array;
      if (held !== null && ArrayBuffer.isView(held) && !this.shared.has(held) && (held as Uint8Array).length === typed.length && held.constructor === value.constructor) {
        (held as Uint8Array).set(typed);
        return held;
      }
      return typed.slice();
    }
    const array = Array.isArray(value);
    let into = held;
    if (into === null || typeof into !== 'object' || this.shared.has(into) || Array.isArray(into) !== array || ArrayBuffer.isView(into)) into = array ? [] : {};
    this.copy(into as Tree, value as Tree);
    return into;
  }

  /** One 32-bit word into both lanes: FNV-1a, and a second multiply-xor lane of its own. */
  private mix(word: number): void {
    this.low = Math.imul(this.low ^ word, FNV_PRIME);
    this.high = Math.imul((this.high ^ word) + (this.high >>> 15), HIGH_PRIME);
  }

  /** Every value under `v`, in order; the data's objects by their own plain fields. */
  private hash(v: unknown, root = false): void {
    if (v === null || v === undefined) return this.mix(v === null ? 1 : 2);
    switch (typeof v) {
      case 'number':
        NUMBER[0] = v;
        this.mix(HALVES[0]!);
        return this.mix(HALVES[1]!);
      case 'boolean':
        return this.mix(v ? 3 : 4);
      case 'string':
        for (let i = 0; i < v.length; i += 1) this.mix(v.charCodeAt(i));
        return this.mix(5);
      case 'object':
        break;
      default:
        return;
    }
    if (ArrayBuffer.isView(v)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const words = bytes.length >> 2;
      const aligned = (v.byteOffset & 3) === 0 ? new Uint32Array(v.buffer, v.byteOffset, words) : null;
      for (let i = 0; i < words; i += 1) this.mix(aligned === null ? bytes[i * 4]! | (bytes[i * 4 + 1]! << 8) | (bytes[i * 4 + 2]! << 16) | (bytes[i * 4 + 3]! << 24) : aligned[i]!);
      for (let i = words * 4; i < bytes.length; i += 1) this.mix(bytes[i]!);
      return this.mix(bytes.length + 6);
    }
    const data = this.shared.has(v);
    if (Array.isArray(v)) {
      this.mix(v.length + 6);
      for (const item of v) if (!(data && item !== null && typeof item === 'object')) this.hash(item);
      return;
    }
    for (const key in v as Record<string, unknown>) {
      if (root && this.own.has(key)) continue;
      const item = (v as Record<string, unknown>)[key];
      if (data && item !== null && typeof item === 'object') continue;
      this.hash(item);
    }
  }
}

const hex = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');
