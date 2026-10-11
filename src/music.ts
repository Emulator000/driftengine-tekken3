/**
 * Music: one track as the audio graph's only stem, started wherever the game's clock says.
 *
 * The track is a slot with no synthesised stand-in, so a file that does not load fails `create`
 * naming it, and a fight never plays to silence over a missing track. `sync` restarts the stem at a
 * point in the track, wrapped by its length, so a skip or a resumed pause lands where the picture is.
 */
import { AudioGraph } from '@driftengine/audio';

const TRACK = 'music';

export class Music {
  muted = false;

  private constructor(private readonly graph: AudioGraph) {}

  static async create(url: string): Promise<Music | null> {
    const graph = await AudioGraph.create({ stemCount: 1 });
    if (graph === null) return null;
    graph.registry.register(TRACK, { urls: [url] });
    await graph.registry.load(graph.context);
    const track = graph.registry.get(TRACK);
    if (track === undefined) throw new Error(`music: ${url} did not load`);
    graph.loadStem(0, track);
    graph.setStemGain(0, 1);
    return new Music(graph);
  }

  /** Whether the browser is letting it make sound yet: only after a click or a key. */
  get audible(): boolean {
    return this.graph.audible;
  }

  /** Call from a gesture. */
  wake(): void {
    this.graph.wake();
  }

  /** Plays from `seconds` into the track, or holds when muted or paused. */
  sync(seconds: number, playing: boolean): void {
    if (this.muted || !playing) this.graph.hold();
    else this.graph.restart(seconds);
  }
}
