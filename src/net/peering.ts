/**
 * A direct connection between the two players (WebRTC), tried once a match is agreed: the host
 * offers, the guest answers, the offer, answer and candidates going through the server as messages
 * between the two. Until it opens, and if it never does, the pads' words go through the server; once
 * it opens they go through it alone, and through the server again, for the rest of the match, once
 * it closes or a wait shows it carries nothing (`relayToo`): the server's own messages may still come
 * and go, so a channel gone quiet would hold both sides waiting for good. A word that comes both ways
 * is the same word, its second copy passed over. The channel is unordered and never resends: a word
 * late is a word of no use, and the next packet carries it again anyway.
 */
import { unreliableChannel } from '@driftengine/network';

import type { SocketLike } from './relay.ts';

/** What a browser's `RTCDataChannel` gives. */
export interface ChannelLike {
  readonly readyState: string;
  binaryType?: string;
  send(data: ArrayBufferView<ArrayBuffer> | ArrayBuffer): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** What a browser's `RTCPeerConnection` gives. */
export interface PeerLike {
  createDataChannel(label: string, options?: unknown): ChannelLike;
  createOffer(): Promise<{ readonly sdp?: string | undefined; readonly type: string }>;
  createAnswer(): Promise<{ readonly sdp?: string | undefined; readonly type: string }>;
  setLocalDescription(description: unknown): Promise<void>;
  setRemoteDescription(description: unknown): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** Milliseconds to wait for the direct connection before keeping to the server. */
export const PEERING_TIMEOUT_MS = 8000;

export interface PeeringOptions {
  readonly peer: PeerLike;
  /** A signalling message for the other player, through the server. */
  readonly signal: (kind: SignalKind, text: string) => void;
  /** The direct channel is open. */
  readonly onDirect: (channel: ChannelLike) => void;
  readonly now?: () => number;
}

export type PeeringState = 'idle' | 'offering' | 'answering' | 'connecting' | 'direct' | 'relayed';
export type SignalKind = 'offer' | 'answer' | 'candidate';

export class Peering {
  private stateNow: PeeringState = 'idle';
  private channel: ChannelLike | null = null;
  private startedAt = 0;
  /** Whether the other side's description is set, which a candidate needs first. */
  private described = false;
  /** Candidates that came before it. */
  private readonly early: string[] = [];
  private why = '';
  private readonly options: PeeringOptions;

  constructor(options: PeeringOptions) {
    this.options = options;
    options.peer.addEventListener('icecandidate', (event) => {
      const candidate = (event as { candidate?: { candidate?: string } | null }).candidate;
      if (candidate?.candidate) options.signal('candidate', JSON.stringify(candidate));
    });
  }

  get state(): PeeringState {
    return this.stateNow;
  }

  /** Why it kept to the server, or the empty string. */
  get reason(): string {
    return this.why;
  }

  private at(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** The host's side: the channel made (an offer with none negotiates nothing), then the offer. */
  async offer(): Promise<void> {
    if (this.stateNow !== 'idle') return;
    this.stateNow = 'offering';
    this.startedAt = this.at();
    this.watch(unreliableChannel(this.options.peer, 'tekken3') as unknown as ChannelLike);
    const description = await this.options.peer.createOffer();
    await this.options.peer.setLocalDescription(description);
    this.options.signal('offer', JSON.stringify(description));
  }

  /** A signalling message from the other player. */
  async accept(kind: SignalKind, text: string): Promise<void> {
    if (this.stateNow === 'relayed') return;
    if (kind === 'candidate') {
      if (!this.described) {
        this.early.push(text);
        return;
      }
      await this.options.peer.addIceCandidate(JSON.parse(text)).catch(() => undefined);
      return;
    }
    if (kind === 'offer') {
      if (this.stateNow !== 'idle') return;
      this.stateNow = 'answering';
      this.startedAt = this.at();
      this.options.peer.addEventListener('datachannel', (event) => {
        const incoming = (event as { channel?: ChannelLike }).channel;
        if (incoming !== undefined) this.watch(incoming);
      });
      await this.options.peer.setRemoteDescription(JSON.parse(text));
      await this.drainEarly();
      const answer = await this.options.peer.createAnswer();
      await this.options.peer.setLocalDescription(answer);
      this.options.signal('answer', JSON.stringify(answer));
      this.stateNow = 'connecting';
      return;
    }
    if (this.stateNow !== 'offering') return;
    await this.options.peer.setRemoteDescription(JSON.parse(text));
    await this.drainEarly();
    this.stateNow = 'connecting';
  }

  private async drainEarly(): Promise<void> {
    this.described = true;
    for (const text of this.early.splice(0)) await this.options.peer.addIceCandidate(JSON.parse(text)).catch(() => undefined);
  }

  private watch(channel: ChannelLike): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => this.opened());
    channel.addEventListener('close', () => this.fallBack('the direct connection closed'));
    channel.addEventListener('error', () => this.fallBack('the direct connection failed'));
    if (channel.readyState === 'open') this.opened();
  }

  private opened(): void {
    if (this.stateNow === 'direct' || this.stateNow === 'relayed' || this.channel === null) return;
    this.stateNow = 'direct';
    this.options.onDirect(this.channel);
  }

  /**
   * Keeps to the server, for good. A direct channel that closes after carrying the match leaves
   * the words with nowhere to go, so the switched socket hears of it and says so (`closed`).
   */
  fallBack(why: string): void {
    if (this.stateNow === 'relayed') return;
    this.stateNow = 'relayed';
    this.why = why;
    this.channel?.close();
    this.channel = null;
  }

  /** On a clock: keeps to the server once the direct connection has taken too long. */
  tick(): void {
    if (this.stateNow === 'idle' || this.stateNow === 'direct' || this.stateNow === 'relayed') return;
    if (this.at() - this.startedAt >= PEERING_TIMEOUT_MS) this.fallBack(`no direct connection after ${PEERING_TIMEOUT_MS / 1000} seconds`);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.options.peer.close();
  }
}

/** A data channel as the socket the engine's transport takes (open is `'open'` there, 1 here). */
export function socketOver(channel: ChannelLike): SocketLike {
  return {
    get readyState(): number {
      return channel.readyState === 'open' ? 1 : 0;
    },
    set binaryType(value: string) {
      channel.binaryType = value;
    },
    send(data) {
      if (channel.readyState === 'open' && typeof data !== 'string') channel.send(data);
    },
    close() {
      channel.close();
    },
    addEventListener(type, listener) {
      channel.addEventListener(type, listener);
    },
  };
}

export interface SwitchableSocket {
  readonly socket: SocketLike;
  /** The words through the direct channel from now, while it is open. */
  switchTo(channel: ChannelLike): void;
  /** The words through the server as well, for the rest of the match: the direct channel is not to be trusted. */
  relayToo(): void;
  /** Whether the words go through the direct channel alone. */
  readonly direct: boolean;
}

/**
 * The socket the match's transport is given, pointed at the direct channel once it opens, and at the
 * server again while it is not open (or as well, once `relayToo`): the same object throughout, so
 * the session (its rollback, its log) never starts over; what listens on it is listened on both, the
 * server's messages heard on as ever.
 */
export function switchableSocket(first: SocketLike): SwitchableSocket {
  let channel: SocketLike | null = null;
  let also = false;
  const open = (): boolean => channel !== null && channel.readyState === 1;
  const registered: [string, (event: unknown) => void][] = [];
  const socket: SocketLike = {
    get readyState(): number {
      return open() ? 1 : first.readyState;
    },
    set binaryType(value: string) {
      first.binaryType = value;
    },
    send(data) {
      const direct = open();
      if (direct) channel!.send(data);
      if (!direct || also) first.send(data);
    },
    close() {
      (channel ?? first).close();
    },
    addEventListener(type, listener) {
      registered.push([type, listener]);
      first.addEventListener(type, listener);
    },
  };
  return {
    socket,
    get direct(): boolean {
      return open() && !also;
    },
    switchTo(to: ChannelLike): void {
      if (channel !== null) return;
      channel = socketOver(to);
      channel.binaryType = 'arraybuffer';
      for (const [type, listener] of registered) if (type === 'message') channel.addEventListener(type, listener);
    },
    relayToo(): void {
      also = true;
    },
  };
}

/** A peer connection from the browser, asking the ICE servers the server named; null where there is none. */
export function browserPeerConnection(iceServers: readonly unknown[]): PeerLike | null {
  const make = (globalThis as { RTCPeerConnection?: new (config: unknown) => unknown }).RTCPeerConnection;
  if (typeof make !== 'function') return null;
  try {
    return new make({ iceServers }) as PeerLike;
  } catch {
    return null;
  }
}
