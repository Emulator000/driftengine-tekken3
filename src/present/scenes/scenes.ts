/**
 * The game's scenes drawn from its state: each scene's own painter over a black picture, nothing
 * at all while the game holds its picture (the window keeps what was last drawn, as the console's
 * screen does).
 */
import type { RendererApi } from '@driftengine/core';
import { Scene, type GameState } from '../../sim/game/state.ts';
import { drawLogo } from './logo.ts';
import { ScreenLayer, type DrawnSprite } from './screen.ts';
import { LightLayer, type DrawnLight } from '../2d/light.ts';
import { drawTitle } from './title.ts';
import type { MoviePicture } from './movie.ts';
import { drawCredits } from './credits.ts';
import { TitleShows } from '../../sim/game/title.ts';
import { drawMenu } from './menu.ts';
import { drawSelect, paintSelectAhead, type SelectPictures } from './select.ts';
import { drawVersus, paintVersusAhead } from './versus.ts';
import { drawRecords } from './records.ts';
import type { SceneTables } from '../../sim/data/scenes.ts';
import type { RosterTables } from '../../sim/data/roster.ts';

/** The original pictures the scenes show as they are. */
export interface ScenePictures {
  readonly title: ImageBitmap;
  readonly namco: ImageBitmap;
  readonly select: SelectPictures;
  /** The credits' namco mark. */
  readonly creditsMark: ImageBitmap;
}

/** What the scenes' drawing reads: the scenes' tables, and the roster's names. */
export interface SceneDrawingData {
  readonly scenes: SceneTables;
  readonly roster: RosterTables;
}

/** A cut's dissolve: how long the frame before it takes to fade out over the new one, in seconds. */
const DISSOLVE = 0.4;

/** The frame before a cut, fading out over the frames after it: its sprites (none when it was 3D), the colour under them, and when it began. */
interface Dissolve {
  readonly art: readonly DrawnSprite[];
  readonly light: readonly DrawnLight[];
  readonly over: readonly DrawnLight[];
  readonly layer: readonly DrawnSprite[];
  readonly colour: readonly [number, number, number];
  readonly start: number;
}

/**
 * The windows' worth of pictures the scenes' art atlas is sized for: a scene's span the window (the
 * select's frame, the versus screen's backdrop), and a dissolve shows two scenes' at once (the
 * select's and the versus screen's together cover about two windows; three leave the packing room).
 */
const ART_SCREENS = 3;

const BLACK = [0, 0, 0] as const;
const WHITE = [1, 1, 1] as const;

/** How much of the picture a fade must hide to count as covering it. */
const COVERING = 0.9;

/** The colour a field's fades all but cover the picture in, if one does (the attract intro ends under white); null when none does. */
function coverOf(fades: readonly { level: number }[]): readonly [number, number, number] | null {
  let cover: readonly [number, number, number] | null = null;
  for (const { level } of fades) {
    if (level < 0x100 && COVERING <= (0xff - level) / 0xff) cover = BLACK;
    else if (0x100 < level && COVERING <= (level - 0x100) / 0xff) cover = WHITE;
  }
  return cover;
}

export class ScenePresenter {
  private readonly renderer: RendererApi;
  private readonly pictures: ScenePictures;
  private readonly data: SceneDrawingData;
  /** The scenes' large pictures under their text, each layer with its own atlas. */
  private readonly art: ScreenLayer;
  private readonly layer: ScreenLayer;
  /** Light added to and taken away from the scenes' pictures, as the original's GPU blends it, between the pictures and the text. */
  private readonly light: LightLayer;
  /** Light taken away over the text as well, after everything (the mode menu's list darkening to its edges). */
  private readonly over: LightLayer;
  private dissolve: Dissolve | null = null;
  /** The last frame the scenes drew, their own sprites without the dissolve's; null when it lay over a 3D picture or a movie, which cannot be drawn again from sprites. */
  private last: Omit<Dissolve, 'colour' | 'start'> | null = null;
  /** Whether the last frame drawn showed a movie's frame. */
  private movieDrawn = false;
  /** The window height the versus screen's backdrops and the select's frame were painted ahead for. */
  private paintedFor = 0;
  /** The colour the last frame drawn was covered in (by its fades), if it was. */
  private cover: readonly [number, number, number] | null = null;

  /** The movies, drawn under the scenes' layers (made before them, so their pass is first). */
  private readonly movie: MoviePicture | null;

  constructor(renderer: RendererApi, data: SceneDrawingData, pictures: ScenePictures, movie: MoviePicture | null = null) {
    this.renderer = renderer;
    this.data = data;
    this.pictures = pictures;
    this.movie = movie;
    this.art = new ScreenLayer(renderer, 'scene art', 1024, 2048, ART_SCREENS);
    this.light = new LightLayer(renderer, 'scene light');
    this.layer = new ScreenLayer(renderer, 'scenes');
    this.over = new LightLayer(renderer, 'scene light over');
  }

  /**
   * A cut at `now` (seconds): the frame before it fades out over what follows. When the scenes
   * drew it (`ours`), it is drawn again from their sprites over black; otherwise (3D) the new
   * frames fade in from the colour that frame's fades covered it in, or from black. A frame of
   * nothing between two scenes (a loader's, a field long) leaves a dissolve under way as it is, so
   * the scene before it fades out whole rather than vanishing into the empty frame.
   */
  cut(now: number, ours: boolean): void {
    const last = ours ? this.last : null;
    if (this.dissolve !== null && last !== null && last.art.length + last.light.length + last.layer.length + last.over.length === 0) return;
    this.dissolve = last !== null ? { ...last, colour: BLACK, start: now } : { art: [], light: [], layer: [], over: [], colour: this.cover ?? BLACK, start: now };
  }

  /**
   * A frame of the game holding its picture (`now` in seconds): while a dissolve still fades the
   * frame before a cut out, the held frame is drawn again under it until it is over, where the
   * window kept the frame the hold began on, the two scenes half over each other for as long as the
   * hold lasted (the versus screen over the character select for its whole wait).
   */
  hold(width: number, height: number, now: number): void {
    const last = this.last;
    if (this.dissolve === null || last === null) return;
    this.renderer.beginFrame([0, 0, 0]);
    this.renderer.endFrame();
    if (this.begin(width, height)) return;
    this.art.redraw(last.art, 1);
    this.light.redraw(last.light, 1);
    this.layer.redraw(last.layer, 1);
    this.over.redraw(last.over, 1);
    this.drawDissolve(now);
    this.end();
  }

  /** Whether the picture moves between fields: a dissolve under way, or a movie's frames drawn. */
  get moving(): boolean {
    return this.dissolve !== null || this.movieDrawn;
  }

  /** What is painted ahead for a window `width` by `height` device pixels: the versus screen's backdrops and the character select's frame, painted at load and again for a new window height. */
  prepare(width: number, height: number): void {
    this.art.begin(width, height);
    this.paintAhead(height);
  }

  private paintAhead(height: number): void {
    paintVersusAhead(this.art);
    paintSelectAhead(this.art);
    this.paintedFor = height;
  }

  /**
   * The layers begun, their atlases keeping every picture while a dissolve still draws the frame
   * before; true when any atlas was emptied (a new height), the dissolve and the last frame then
   * dropped with their pictures.
   */
  private begin(width: number, height: number): boolean {
    const keep = this.dissolve !== null;
    const art = this.art.begin(width, height, keep);
    const layer = this.layer.begin(width, height, keep);
    const light = this.light.begin(width, height, keep);
    const over = this.over.begin(width, height, keep);
    if (height !== this.paintedFor) this.paintAhead(height);
    if (!(art || layer || light || over)) return false;
    this.dissolve = null;
    this.last = null;
    return true;
  }

  /** Both layers drawn. */
  private end(): void {
    this.art.end();
    this.light.end();
    this.layer.end();
    this.over.end();
  }

  /**
   * The dissolve over this frame's layers, begun. The colour under the frame before goes under its
   * pictures, in the pictures' pass, where it lay in the text's and covered them: the first frames
   * of every dissolve showed the frame before as its text alone on black. With no pictures to fade
   * out (after a 3D frame) it covers the whole new frame, which fades in from it.
   */
  private drawDissolve(now: number): void {
    const d = this.dissolve;
    if (d === null) return;
    const t = (now - d.start) / DISSOLVE;
    if (1 <= t) {
      this.dissolve = null;
      return;
    }
    const alpha = 1 - t * t * (3 - 2 * t);
    (d.art.length === 0 ? this.layer : this.art).fillWindow([...d.colour, alpha]);
    this.art.redraw(d.art, alpha);
    this.light.redraw(d.light, alpha);
    this.layer.redraw(d.layer, alpha);
    this.over.redraw(d.over, alpha);
  }

  /** This field's picture, unless the game holds the last one; false when it held. Over a 3D picture already drawn this frame (`over`), nothing is cleared. */
  render(game: GameState, width: number, height: number, over = false, now = 0): boolean {
    if (game.held !== 0) return false;
    const layer = this.layer;
    if (!over) {
      this.renderer.beginFrame([0, 0, 0]);
      this.renderer.endFrame();
    }
    this.begin(width, height);
    switch (game.scene) {
      case Scene.LOGO:
        drawLogo(game, layer);
        break;
      case Scene.TITLE:
        if (game.title.shows === TitleShows.MOVIE) this.movie?.draw(width, height);
        drawTitle(game, game.title.shows, this.art, layer, this.pictures);
        break;
      case Scene.MOVIE:
        /* The ending: its movie (drawn whole by the movie's own pass), then the credits. */
        if (game.step === 3 && this.movie?.showing !== true) drawCredits(game, this.data.scenes.credits, this.art, layer, this.pictures.creditsMark);
        else this.movie?.draw(width, height);
        break;
      case Scene.ATTRACT:
        drawTitle(game, game.attractScreen.draw, this.art, layer, this.pictures);
        break;
      case Scene.MENU:
        drawMenu(game, this.art, layer, this.over, this.pictures.title);
        break;
      case Scene.SELECT:
        drawSelect(game, this.data.scenes, this.data.roster, this.art, this.light, layer, this.pictures.select);
        break;
      case Scene.VERSUS:
        drawVersus(game, this.art, layer, this.pictures.select.portraits);
        break;
      case Scene.RECORDS:
        drawRecords(game, this.data.scenes, this.art, layer, this.pictures.select.smallIcons);
        break;
      case Scene.FIGHT:
        /* Ogre's change: its fades over its picture. */
        for (const run of game.printed) layer.print(run);
        for (const { level } of game.fades) layer.fade(level);
        break;
      default:
        for (const run of game.printed) layer.print(run);
    }
    const movie = (game.scene === Scene.TITLE && game.title.shows === TitleShows.MOVIE) || (game.scene === Scene.MOVIE && this.movie?.showing === true);
    this.movieDrawn = movie;
    this.last = over || movie ? null : { art: this.art.drawn.slice(), light: this.light.drawn.slice(), layer: layer.drawn.slice(), over: this.over.drawn.slice() };
    this.cover = coverOf(game.fades);
    this.drawDissolve(now);
    this.end();
    return true;
  }

  /** A dissolve over a frame the scenes did not draw (the fight's); nothing when none is under way. */
  renderDissolve(width: number, height: number, now: number): void {
    this.cover = null;
    this.last = null;
    this.movieDrawn = false;
    if (this.dissolve === null) return;
    if (this.begin(width, height)) return;
    this.drawDissolve(now);
    this.end();
  }
}
