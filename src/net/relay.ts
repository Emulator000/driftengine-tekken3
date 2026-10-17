/**
 * The connection to the online server (`server/relay.mjs`): one WebSocket for everything. A text
 * message is the server's or the other player's JSON (the lobby, the match's setup, the direct
 * connection's signalling); a binary one is the pads' words, which go to the engine's transport
 * through `forInputs` and nowhere else, so neither kind is ever read as the other.
 */

/** What a browser `WebSocket` and the engine's transport both take. */
export interface SocketLike {
  readonly readyState: number;
  binaryType?: string;
  send(data: ArrayBufferView<ArrayBuffer> | ArrayBuffer | string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** The protocol's version and game, as the server checks them at the hello. */
export const PROTOCOL = 1;
export const GAME = 'tekken3';
/** Room codes, as the server makes them. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** A room the server lists. */
export interface ListedRoom {
  readonly code: string;
  readonly title: string;
  readonly host: string;
  readonly locked: boolean;
  /** Whether this player can join it: its host plays the same version, with a fighter whose data this one has. */
  readonly same: boolean;
}

/** What the server says. */
export type ServerEvent =
  | { readonly ev: 'welcome'; readonly name: string; readonly motd: string; readonly ice: readonly unknown[]; readonly players: number; readonly queued?: number; readonly rooms: number }
  | { readonly ev: 'hosting'; readonly code: string; readonly listed: boolean }
  | { readonly ev: 'queued'; readonly waiting: number }
  | { readonly ev: 'offer'; readonly peer: { readonly name: string }; readonly seconds: number }
  | { readonly ev: 'idle'; readonly why: string }
  | { readonly ev: 'paired'; readonly seat: 0 | 1; readonly code: string; readonly peer: { readonly name: string } }
  | { readonly ev: 'rooms'; readonly rooms: readonly ListedRoom[] }
  | { readonly ev: 'peer'; readonly body: unknown }
  | { readonly ev: 'left'; readonly why: string }
  | { readonly ev: 'refused'; readonly why: string; readonly theirs?: unknown }
  | { readonly ev: 'pong'; readonly t: number; readonly players?: number; readonly queued?: number }
  | { readonly ev: 'error'; readonly why: string };

const OPEN = 1;
/** Commands held while the socket opens, at most. */
const MOST_HELD = 64;

export class RelayClient {
  /** The server's events, as they arrive. */
  onEvent: (event: ServerEvent) => void = () => {};
  /** The connection closed (or never opened). */
  onClosed: () => void = () => {};
  /** The socket the engine's transport is given: the pads' words, and nothing else. */
  readonly forInputs: SocketLike;

  private readonly socket: SocketLike;
  private readonly listeners: ((event: unknown) => void)[] = [];
  private readonly held: string[] = [];
  private shut = false;

  /** `carried`, commands another connection held unsent (a way to the server that failed), sent once this one opens. */
  constructor(url: string, open: (url: string) => SocketLike = (at) => new WebSocket(at) as unknown as SocketLike, carried: readonly string[] = []) {
    this.socket = open(url);
    this.held.push(...carried);
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('message', (event) => this.arrived((event as { data?: unknown }).data));
    this.socket.addEventListener('open', () => {
      for (const text of this.held.splice(0)) this.socket.send(text);
    });
    this.socket.addEventListener('close', () => this.closed());
    this.socket.addEventListener('error', () => this.closed());
    const outer = this;
    this.forInputs = {
      binaryType: 'arraybuffer',
      get readyState(): number {
        return outer.socket.readyState;
      },
      send(data): void {
        /* A word for a field: sent now or not at all, as a late one is of no use. */
        if (outer.socket.readyState === OPEN && typeof data !== 'string') outer.socket.send(data);
      },
      close(): void {},
      addEventListener(type, listener): void {
        if (type === 'message') outer.listeners.push(listener);
      },
    };
  }

  get open(): boolean {
    return !this.shut && this.socket.readyState === OPEN;
  }

  get closedNow(): boolean {
    return this.shut;
  }

  /** A command for the server, sent once the socket is open. */
  say(command: { readonly do: string } & Record<string, unknown>): void {
    const text = JSON.stringify(command);
    if (this.socket.readyState === OPEN) this.socket.send(text);
    else if (!this.shut && this.held.length < MOST_HELD) this.held.push(text);
  }

  /** A message for the other player, passed on by the server unread. */
  toPeer(body: unknown): void {
    this.say({ do: 'peer', body });
  }

  /** The commands held for a socket that never opened, given up for another connection to send. */
  unsent(): string[] {
    return this.held.splice(0);
  }

  close(): void {
    this.shut = true;
    this.held.length = 0;
    this.socket.close();
  }

  private arrived(data: unknown): void {
    if (typeof data === 'string') {
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event !== null && typeof event === 'object' && typeof (event as { ev?: unknown }).ev === 'string') this.onEvent(event as ServerEvent);
      return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    if (bytes !== null) for (const listener of this.listeners) listener({ data: bytes });
  }

  private closed(): void {
    if (this.shut) return;
    this.shut = true;
    this.onClosed();
  }
}

/** Whether a string is a room code the server could have made. */
export function isRoomCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}
