/**
 * The sound's worklet: the mixer run on the audio thread at the chip's rate, given the banks and
 * the music's tables once, each field's commands as the game makes them, and each song's bytes as
 * they arrive; a movie's sound on its input. Before the banks are in it plays silence.
 */
import type { SoundCommand } from '../../sim/fight/voices.ts';
import type { PlayableBanks } from './banks.ts';
import { Mixer } from './mixer.ts';
import type { MusicTables } from './music.ts';

/** What the page sends the worklet. */
export type SoundMessage =
  | { readonly kind: 'start'; readonly banks: PlayableBanks; readonly music: MusicTables }
  | { readonly kind: 'field'; readonly commands: readonly SoundCommand[]; readonly vabs: readonly number[]; readonly frameRan: boolean; readonly vblank: number }
  | { readonly kind: 'song'; readonly xa: number; readonly bytes: Uint8Array }
  | { readonly kind: 'track'; readonly track: number; readonly samples: Int16Array };

/** What the worklet tells the page: the song it plays (its XA song, the start it was made for) and the samples of it put out so far, or null. */
export type SoundReport = { readonly xa: number; readonly starts: number; readonly samples: number } | null;

/** Render quanta (128 samples each) between the worklet's reports. */
const REPORT_EVERY = 8;

/* The worklet's scope, which the DOM's types leave out. */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class GameSound extends AudioWorkletProcessor {
  private mixer: Mixer | null = null;
  private quanta = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<SoundMessage>) => this.receive(event.data);
  }

  private receive(message: SoundMessage): void {
    if (message.kind === 'start') this.mixer = new Mixer(message.banks, message.music);
    else if (message.kind === 'field') this.mixer?.field(message.commands, message.vabs, message.frameRan, message.vblank);
    else if (message.kind === 'song') this.mixer?.song(message.xa, message.bytes);
    else this.mixer?.track(message.track, message.samples);
  }

  /** The movie's sound comes in on the first input (stereo, or mono into both), the drive's CD audio while it reads a movie. */
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0]!;
    if (left === undefined || right === undefined) return true;
    if (this.mixer === null) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    const input = inputs[0];
    const cd = input !== undefined && 0 < input.length ? ([input[0]!, input[1] ?? input[0]!] as const) : undefined;
    this.mixer.render(left, right, cd);
    this.quanta += 1;
    if (this.quanta % REPORT_EVERY === 0) this.port.postMessage(this.mixer.songPlayed satisfies SoundReport);
    return true;
  }
}

registerProcessor('game-sound', GameSound);
