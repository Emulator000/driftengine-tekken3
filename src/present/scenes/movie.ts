/**
 * The movies on screen: the extraction's web video of each movie file played in step with the
 * simulation's player. The simulation says which frame shows from which vertical blank (`movie.shows`,
 * a frame's, as the movie's frames wait on the drive's stream), and when the drive reads a movie's
 * file and when it is paused (its sound commands); the video starts as the first frame shows,
 * plays at its own rate, and is sought back to the simulation's frame when it drifts (the tab held
 * back, the decoder late). Its sound goes into the sound player's CD input, where the music's
 * driver mixes it at its volume, and plays on after the last frame for as long as the drive reads
 * (the opening's runs into the title); a pause stops it.
 *
 * The console shows a movie in its own display mode, 256 or 320 pixels across the whole width and
 * 240 lines, the movie's frame centred in them; here the frame fills the screen's width (the
 * original's 4:3) and its share of the lines, over black (or the screen white, as the other movie
 * ends). The video, enlarged three times at extraction, is drawn smoothly.
 */
import type { RendererApi } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { MovieTables } from '../../sim/data/scenes.ts';
import type { GameState, MovieShow } from '../../sim/game/state.ts';
import { SCREEN } from './screen.ts';
import { TimedCommands } from '../sound/timed.ts';

/** How far (in frames) the video may stray from the simulation's frame before it is sought. */
const DRIFT = 2;
/** The movie's slot in its pass, and the captions' sheet's. */
const SLOT = 0;
const CAPTIONS = 1;
const WHITE = new Float32Array([1, 1, 1, 1]);
const BLACK = new Float32Array([0, 0, 0, 1]);

export class MoviePicture {
  private readonly pass: SpritePass;
  private readonly renderer: RendererApi;
  private readonly handle: number;
  private readonly tables: MovieTables;
  private readonly url: (file: number) => string;
  private readonly connect: (video: HTMLVideoElement) => void;
  private readonly videos = new Map<number, HTMLVideoElement>();
  /** The video the drive reads, if any. */
  private reading: { file: number; video: HTMLVideoElement } | null = null;
  /** The last frame that ran's shows, and what the screen shows now. */
  private shows: readonly MovieShow[] = [];
  private shown: MovieShow | null = null;
  /** The frames each file's video has presented, where the browser counts them. */
  private readonly presented = new Map<number, number>();
  /** The frame canvas the video is copied into, and the file and frame it holds. */
  private canvas: OffscreenCanvas | null = null;
  private copied = '';
  private readonly transform = new Float32Array(6);
  /** Whether sound may play (the player woke on a gesture). */
  audible = false;
  /** The drive's commands not yet due. */
  private readonly timed = new TimedCommands();
  /** The endings' captions' sheet (each caption under the one before, enlarged), once given. */
  private captionSheet: { width: number; height: number } | null = null;

  /** The captions' picture, laid over the frames that show one. */
  setCaptions(sheet: ImageBitmap): void {
    this.pass.setTexture(CAPTIONS, sheet, { filter: 'linear', colorSpace: 'srgb' });
    this.captionSheet = { width: sheet.width, height: sheet.height };
  }

  /** `url` gives a movie file's video, `connect` routes a video's sound into the sound player. */
  constructor(renderer: RendererApi, tables: MovieTables, url: (file: number) => string, connect: (video: HTMLVideoElement) => void) {
    this.tables = tables;
    this.url = url;
    this.connect = connect;
    this.renderer = renderer;
    this.pass = createSpritePass({ label: 'movie', capacity: 8, slots: 2 });
    this.handle = renderer.registerPass(this.pass);
  }

  private video(file: number): HTMLVideoElement {
    let video = this.videos.get(file);
    if (video === undefined) {
      video = document.createElement('video');
      video.src = this.url(file);
      video.preload = 'auto';
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      this.connect(video);
      this.videos.set(file, video);
      /* Each frame the video presents counted, so a frame is copied once (where the browser can say). */
      const counted = video;
      const presented = (): void => {
        this.presented.set(file, (this.presented.get(file) ?? 0) + 1);
        counted.requestVideoFrameCallback(presented);
      };
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(presented);
    }
    return video;
  }

  /** A field of the game: the drive's reads and pauses (when they are due), the frame showing now, the video kept to it. */
  field(game: GameState): void {
    const world = game.world;
    if (game.codeRan !== 0) this.timed.add(world.sound.commands, game.vblanks);
    for (const c of this.timed.due(game.vblanks)) {
      if (c.key === 'movie read') {
        this.reading?.video.pause();
        const file = this.tables.files.findIndex((f) => f !== null && f.first === c.sector);
        const video = this.video(file);
        video.pause();
        video.currentTime = 0;
        this.reading = { file, video };
      } else if (c.key === 'drive pause' || c.key === 'song') {
        this.reading?.video.pause();
        this.reading = null;
      }
    }
    if (game.codeRan !== 0) this.shows = [...game.movie.shows];
    for (const show of this.shows) if (show.at <= game.vblanks) this.shown = show;
    const reading = this.reading;
    if (reading === null) return;
    const video = reading.video;
    video.muted = !this.audible;
    const shown = this.shown;
    if (shown === null || shown.file !== reading.file || shown.frame === 0) {
      /* Before its first frame the video waits; after its last it plays on, heard and not seen. */
      if (video.paused && 0 < video.currentTime && !video.ended) void video.play().catch(() => {});
      return;
    }
    const rate = this.tables.files[reading.file]?.rate ?? 20;
    if (video.paused && !video.ended) void video.play().catch(() => {});
    const at = Math.floor(video.currentTime * rate) + 1;
    if (DRIFT < Math.abs(at - shown.frame)) {
      video.currentTime = (shown.frame - 1) / rate;
      this.seeks += 1;
    }
  }

  /** For the page's probe: the frame the simulation shows, the video's own frame there, and how often it was sought. */
  probe(): { frame: number; video: number; seeks: number } | null {
    const shown = this.shown;
    if (shown === null || shown.frame === 0 || this.reading === null) return null;
    const rate = this.tables.files[this.reading.file]?.rate ?? 20;
    return { frame: shown.frame, video: Math.floor(this.reading.video.currentTime * rate) + 1, seeks: this.seeks };
  }

  private seeks = 0;

  /** Whether the screen shows a movie's frame now. */
  get showing(): boolean {
    return this.shown !== null && this.shown.frame !== 0;
  }

  /** The screen as the movie leaves it: its frame over black, or black, or white; `width` by `height` device pixels. */
  draw(width: number, height: number): void {
    const half = (SCREEN.across / 2) * (width / height);
    this.transform.set([1 / half, 0, 0, -2 / SCREEN.lines, -(SCREEN.width / 2) / half, 1]);
    this.pass.setTransform(this.transform);
    this.pass.reset();
    const shown = this.shown;
    const white = shown !== null && shown.frame === 0 && shown.white;
    drawSprite(this.pass.batch, this.pass.white, { x: 0, y: 0, w: SCREEN.width, h: SCREEN.lines }, null, white ? WHITE : BLACK);
    const video = shown === null || shown.frame === 0 ? undefined : this.videos.get(shown.file);
    const record = shown === null ? undefined : this.tables.movies.find((m) => m.file === shown.file);
    if (video !== undefined && record !== undefined && 2 <= video.readyState && this.copyFrame(video, shown!.file)) {
      const lines = (record.height / 240) * SCREEN.lines;
      const top = (SCREEN.lines - lines) / 2;
      drawSprite(this.pass.batch, SLOT, { x: 0, y: top, w: SCREEN.width, h: lines }, null, null);
      if (shown !== null && 0 <= shown.caption) this.drawCaption(shown.caption, record, top, lines);
    }
    this.renderer.drawPass(this.handle);
  }

  /** A caption laid over the frame where the decoder lays it (its place in the frame's pixels). */
  private drawCaption(caption: number, record: { readonly width: number; readonly height: number }, top: number, lines: number): void {
    const sheet = this.captionSheet;
    const place = this.tables.captions[caption];
    if (sheet === null || place === undefined) return;
    const above = this.tables.captions.slice(0, caption).reduce((n, c) => n + c.height, 0);
    const total = this.tables.captions.reduce((n, c) => n + c.height, 0);
    const widest = Math.max(...this.tables.captions.map((c) => c.width));
    const uv = { u0: 0, v0: above / total, u1: place.width / widest, v1: (above + place.height) / total };
    const across = SCREEN.width / record.width;
    const down = lines / record.height;
    drawSprite(this.pass.batch, CAPTIONS, { x: place.x * across, y: top + place.y * down, w: place.width * across, h: place.height * down }, uv, null);
  }

  /** The video's frame now into the pass's slot, when it moved on; whether the slot holds one. */
  private copyFrame(video: HTMLVideoElement, file: number): boolean {
    /*
     * Copied once a frame the video presents (15 or 20 a second), or without the browser's count
     * once a frame of its stream's rate, where every move of its time (every display frame) copied
     * and uploaded it again.
     */
    const count = this.presented.get(file);
    const frame = `${file} ${count ?? Math.floor(video.currentTime * (this.tables.files[file]?.rate ?? 20))}`;
    if (frame === this.copied && this.canvas !== null) return true;
    const { videoWidth: w, videoHeight: h } = video;
    if (w === 0 || h === 0) return this.canvas !== null;
    if (this.canvas === null || this.canvas.width !== w || this.canvas.height !== h) this.canvas = new OffscreenCanvas(w, h);
    const g = this.canvas.getContext('2d');
    if (g === null) return false;
    g.drawImage(video, 0, 0, w, h);
    /* As the scenes' pictures are: decoded as read, so the screen encode gives the frame's colours back. */
    this.pass.setTexture(SLOT, this.canvas, { filter: 'linear', colorSpace: 'srgb' });
    this.copied = frame;
    return true;
  }
}
