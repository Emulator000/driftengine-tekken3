/** The online matches' server (`relay.mjs`), as the dev server runs it beside the page. */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface RelayConfig {
  readonly [setting: string]: unknown;
}

export declare const PROTOCOL: number;
export declare const CODE_ALPHABET: string;
export declare const CODE_LENGTH: number;

export declare function readConfig(argv?: readonly string[], env?: Readonly<Record<string, string | undefined>>): RelayConfig;

export declare class Relay {
  constructor(config: RelayConfig, options?: { readonly now?: () => number; readonly log?: (line: string) => void });
  listen(): Promise<number>;
  attach(server: Server, path: string): void;
  /** Its HTTP answers: its page, its numbers (`status.json`) and its health. */
  http(request: IncomingMessage & { readonly originalUrl?: string | undefined }, response: ServerResponse): void;
  close(): Promise<void>;
}
