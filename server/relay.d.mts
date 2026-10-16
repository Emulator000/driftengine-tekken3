/** The online matches' server (`relay.mjs`), as the dev server runs it beside the page. */
import type { Server } from 'node:http';

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
  close(): Promise<void>;
}
