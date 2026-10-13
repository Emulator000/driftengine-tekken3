/**
 * The game heard: an AudioWorklet at the chip's rate running the mixer, sent the banks and the
 * music's tables once, then each field's commands and the banks the match loaded into its slots.
 * A song's bytes are fetched the first time a command names it (readied or played) and sent on.
 * The browser starts audio only after a gesture: until then every field still goes (the music's
 * driver steps a field at a time) but without its key-ons, so none waits to sound late.
 */
import { audioContextConstructor, claimPlaybackSession } from '@driftengine/audio';
import type { FightState } from '../../sim/fight/state.ts';
import type { PlayableBanks } from './banks.ts';
import type { MusicTables } from './music.ts';
import type { SoundMessage } from './processor.ts';
import processorUrl from './processor.ts?worker&url';
import { CHIP_RATE } from './voices.ts';
import { THEATER_SLOT } from './mixer.ts';

const VOICE_KEYS = new Set(['on', 'off']);

export class SoundPlayer {
  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  /** The output's level, for the page's probe. */
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(2048);
  private readonly music: MusicTables;
  private readonly fetchSong: (xa: number) => Promise<ArrayBuffer>;
  private readonly asked = new Set<number>();
  /** The set songs pick from (-1 none), as the game's music options last said. */
  private set: number;

  private readonly fetchTrack: (track: number) => Promise<ArrayBuffer>;

  private constructor(context: AudioContext, node: AudioWorkletNode, music: MusicTables, fetchSong: (xa: number) => Promise<ArrayBuffer>, fetchTrack: (track: number) => Promise<ArrayBuffer>) {
    this.context = context;
    this.node = node;
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    node.connect(this.meter);
    this.music = music;
    this.set = music.set === 1 ? 1 : 0;
    this.fetchSong = fetchSong;
    this.fetchTrack = fetchTrack;
  }

  /** The player, or null where the browser has no Web Audio or no worklets. `fetchSong` fetches an XA song's file by its number, `fetchTrack` an audio track's samples. */
  static async create(banks: PlayableBanks, music: MusicTables, fetchSong: (xa: number) => Promise<ArrayBuffer>, fetchTrack: (track: number) => Promise<ArrayBuffer>): Promise<SoundPlayer | null> {
    const Context = audioContextConstructor();
    if (Context === undefined) return null;
    claimPlaybackSession();
    const context = new Context({ sampleRate: CHIP_RATE });
    if (context.audioWorklet === undefined) return null;
    await context.audioWorklet.addModule(processorUrl);
    const node = new AudioWorkletNode(context, 'game-sound', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(context.destination);
    const player = new SoundPlayer(context, node, music, fetchSong, fetchTrack);
    player.send({ kind: 'start', banks, music });
    return player;
  }

  /** From a gesture: let the audio start. */
  wake(): void {
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Whether the audio runs (after a gesture). */
  get running(): boolean {
    return this.context.state === 'running';
  }

  /** Whether the audio runs, and its output's loudness just now (root mean square, 0 to 1). */
  probe(): { running: boolean; level: number } {
    this.meter.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    return { running: this.running, level: Math.round(Math.sqrt(sum / this.samples.length) * 1e4) / 1e4 };
  }

  /** A movie's video, its sound into the CD input (once for each element: the browser routes it here alone after). */
  connectMovie(video: HTMLVideoElement): void {
    this.context.createMediaElementSource(video).connect(this.node);
  }

  /** A field's sound (vertical blank `vblank`): its commands (only the music's before the audio runs) and the banks in its slots. */
  field(state: FightState, vblank: number): void {
    const commands = this.running ? [...state.sound.commands] : state.sound.commands.filter((c) => !VOICE_KEYS.has(c.key));
    for (const c of commands) {
      if (c.key === 'music options') this.set = c.set;
      else if (c.key === 'song') this.fetch(c.song, this.set);
      else if (c.key === 'theater song') this.fetch(c.song, c.set);
    }
    /* VAB 2 holding the Theater's own bank goes as its own slot number. */
    const vabs = [...state.sound.vabs];
    if (state.sound.theater !== 0) vabs[2] = THEATER_SLOT;
    this.send({ kind: 'field', commands, vabs, frameRan: state.frameRan !== 0, vblank });
  }

  /** A song's XA song, or its audio track's samples, fetched and sent, once. */
  private fetch(song: number, set: number): void {
    if (set < 0) return;
    const pick = this.music.picks[song]?.[set];
    if (pick === undefined) return;
    const key = pick.track ? 0x100 + pick.xa : pick.xa;
    if (this.asked.has(key)) return;
    this.asked.add(key);
    if (pick.track) {
      void this.fetchTrack(pick.xa)
        .then((bytes) => this.send({ kind: 'track', track: pick.xa, samples: new Int16Array(bytes) }))
        .catch((error: unknown) => console.error(`[tekken3] audio track ${pick.xa}:`, error));
      return;
    }
    void this.fetchSong(pick.xa)
      .then((bytes) => this.send({ kind: 'song', xa: pick.xa, bytes: new Uint8Array(bytes) }))
      .catch((error: unknown) => console.error(`[tekken3] song ${pick.xa}:`, error));
  }

  private send(message: SoundMessage): void {
    this.node.port.postMessage(message);
  }
}
