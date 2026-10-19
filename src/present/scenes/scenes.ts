/**
 * The game's scenes drawn from its state: each scene's own painter over a black picture, nothing
 * at all while the game holds its picture (the window keeps what was last drawn, as the console's
 * screen does).
 */
import type { RendererApi } from '@driftengine/core';
import { Scene, type GameState } from '../../sim/game/state.ts';
import { drawLogo } from './logo.ts';
import { FIGHT_SCREEN, SCREEN, ScreenLayer, type DrawnSprite } from './screen.ts';
import { LightLayer, type DrawnLight } from '../2d/light.ts';
import { drawTitle } from './title.ts';
import type { MoviePicture } from './movie.ts';
import { drawCredits } from './credits.ts';
import { TitleShows } from '../../sim/game/title.ts';
import { drawOptions } from './options.ts';
import { drawScene, type DrawnPictures } from './drawn.ts';
import { CONSOLE_PADS, controlWords, type Controllers } from '../2d/controls.ts';
import { drawMenu, NO_CORNER, type MenuCorner } from './menu.ts';
import { drawSelect, paintSelectAhead, type SelectPictures } from './select.ts';
import { drawVersus, paintVersusAhead } from './versus.ts';
import { drawVsSelect } from './vs-select.ts';
import { drawForceResults, drawSurvivalResults, drawTeamResults, drawTimeResults } from './results.ts';
import { drawRecords } from './records.ts';
import type { SceneTables } from '../../sim/data/scenes.ts';
import type { RosterTables } from '../../sim/data/roster.ts';
import type { BallTables } from '../../sim/data/ball.ts';
import type { MathTables } from '../../sim/data/tables.ts';
import { BallView } from '../3d/ball.ts';

/** The original pictures the scenes show as they are. */
export interface ScenePictures {
  readonly title: ImageBitmap;
  readonly namco: ImageBitmap;
  readonly select: SelectPictures;
  /** The credits' namco mark. */
  readonly creditsMark: ImageBitmap;
  /** Time Attack's results' backdrop, and Tekken Force's. */
  readonly results: ImageBitmap;
  readonly forceResults: ImageBitmap;
  /** The Options' backdrop; the pictures the scenes' own draws use. */
  readonly optionsBackdrop: ImageBitmap;
  readonly drawn: DrawnPictures;
}

/** What the scenes' drawing reads: the scenes' tables, and the roster's names. */
export interface SceneDrawingData {
  readonly scenes: SceneTables;
  readonly roster: RosterTables;
  /** Tekken Ball's ball (drawn on its select) and the turns' tables it is turned by. */
  readonly ball: BallTables;
  readonly math: MathTables;
}

/** A cut's dissolve, in seconds: the frame before it fading out to a colour for half of it, then the new frames fading in from it. */
const DISSOLVE = 0.4;

/** The frame before a cut, fading out before the frames after it fade in: its sprites (none when it was 3D), the colour it goes to, and when it began. */
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

/** Units past the screen's middle a quad covering the whole window reaches, every way. */
const WINDOW = 0x4000;

/** How much of the picture a fade must hide to count as covering it. */
const COVERING = 0.9;

/** Tekken Ball's mode, whose select shows the ball being chosen. */
const TEKKEN_BALL = 7;

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
  /** The players' controllers, whose buttons the scenes show. */
  controllers: Controllers = CONSOLE_PADS;
  /** The mode menu's corner: the game's version, and whether a newer one is out. */
  menuCorner: MenuCorner = NO_CORNER;
  /** The scenes' large pictures under their text, each layer with its own atlas. */
  private readonly art: ScreenLayer;
  private readonly layer: ScreenLayer;
  /** What a mode draws of its own over the fight (practice's menus and HUD), in the fight's units. */
  private readonly fightLayer: ScreenLayer;
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

  /** Tekken Ball's ball on its select, made the first time it is drawn. */
  private ball: BallView | null = null;

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
    this.layer.words = (text) => controlWords(text, this.controllers);
    this.fightLayer = new ScreenLayer(renderer, 'fight 2d', 2048, 2048, 0, FIGHT_SCREEN);
    this.fightLayer.words = this.layer.words;
    this.over = new LightLayer(renderer, 'scene light over');
  }

  /**
   * A cut at `now` (seconds): the frame before it fades out, alone, then what follows fades in, the
   * two never drawn over each other. When the scenes drew it (`ours`), it is drawn again from their
   * sprites, going to black; otherwise (3D) the new frames fade in from the colour that frame's
   * fades covered it in, or from black, over the whole dissolve. A frame of
   * nothing between two scenes (a loader's, a field long) leaves a dissolve under way as it is, so
   * the scene before it fades out whole rather than vanishing into the empty frame.
   */
  cut(now: number, ours: boolean): void {
    const last = ours ? this.last : null;
    if (this.dissolve !== null && last !== null && last.art.length + last.light.length + last.layer.length + last.over.length === 0) return;
    this.dissolve = last !== null ? { ...last, colour: BLACK, start: now } : { art: [], light: [], layer: [], over: [], colour: this.cover ?? BLACK, start: now };
  }

  /**
   * A frame of the game holding its picture (`now` in seconds): while a dissolve is under way, the
   * held frame is drawn again for it until it is over, where the window kept the frame the hold
   * began on, which the dissolve never finished (the character select's last frame over the versus
   * screen's for its whole wait).
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
    this.drawDissolve(width, height, now);
    this.end();
  }

  /**
   * The last frame the scenes drew, drawn again whole over a frame drawn to be hidden (an online
   * fight drawn before it shows, so a device slow to draw its first pictures is slow behind its
   * versus screen); false where there is none to draw again (it lay over a 3D picture or a movie),
   * the frame then black.
   */
  redrawLast(width: number, height: number): boolean {
    const last = this.last;
    this.renderer.beginFrame([0, 0, 0]);
    this.renderer.endFrame();
    if (last === null || this.begin(width, height, true)) return false;
    this.art.redraw(last.art, 1);
    this.light.redraw(last.light, 1);
    this.layer.redraw(last.layer, 1);
    this.over.redraw(last.over, 1);
    this.end();
    return true;
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
   * before (or the last frame is drawn again, `keep`); true when any atlas was emptied (a new
   * height), the dissolve and the last frame then dropped with their pictures.
   */
  private begin(width: number, height: number, keep = this.dissolve !== null): boolean {
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
   * The dissolve over this frame's layers, begun: for its first half the frame before alone (what
   * this frame drew set aside, its pictures kept painted), going to its colour; then this frame,
   * coming out of it. After a 3D frame, with nothing of the frame before to draw, the new frame
   * comes out of the colour over the whole dissolve. The colour is laid over everything, in the
   * last pass.
   */
  private drawDissolve(width: number, height: number, now: number): void {
    const d = this.dissolve;
    if (d === null) return;
    const t = (now - d.start) / DISSOLVE;
    if (1 <= t) {
      this.dissolve = null;
      return;
    }
    const smooth = (x: number): number => x * x * (3 - 2 * x);
    const before = d.art.length + d.light.length + d.layer.length + d.over.length !== 0;
    if (!before) {
      this.coverWith(d.colour, 1 - smooth(t));
      return;
    }
    if (0.5 <= t) {
      this.coverWith(d.colour, 1 - smooth(t * 2 - 1));
      return;
    }
    this.art.begin(width, height, true);
    this.light.begin(width, height, true);
    this.layer.begin(width, height, true);
    this.over.begin(width, height, true);
    /* On black, as it was drawn, whatever this frame drew under the layers (a 3D picture). */
    this.art.fillWindow([0, 0, 0, 1]);
    this.art.redraw(d.art, 1);
    this.light.redraw(d.light, 1);
    this.layer.redraw(d.layer, 1);
    this.over.redraw(d.over, 1);
    this.coverWith(d.colour, smooth(t * 2));
  }

  /** The whole window in a colour at `alpha`, over everything the layers drew. */
  private coverWith(colour: readonly [number, number, number], alpha: number): void {
    if (alpha <= 0) return;
    this.over.quad('over', -WINDOW, -WINDOW, WINDOW * 2, WINDOW * 2, colour, colour, null, false, Math.min(1, alpha));
  }

  /** This field's picture, unless the game holds the last one; false when it held. Over a 3D picture already drawn this frame (`over`), nothing is cleared. */
  render(game: GameState, width: number, height: number, over = false, now = 0): boolean {
    if (game.held !== 0) return false;
    const layer = this.layer;
    const ball = !over && game.scene === Scene.VS_SELECT && game.vsSelect.mode === TEKKEN_BALL;
    if (!over && !ball) {
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
        /* The Theater's menu (its lines cut to the screen); the ending: its movie (drawn whole by the movie's own pass), then the credits. */
        if (game.step === 1) {
          layer.clipAcross(0, SCREEN.width);
          drawScene(game, layer, this.drawnContext());
          layer.clipAcross(null);
        } else if (game.step === 3 && this.movie?.showing !== true) drawCredits(game, this.data.scenes.credits, this.art, layer, this.pictures.creditsMark);
        else this.movie?.draw(width, height);
        break;
      case Scene.ATTRACT:
        drawTitle(game, game.attractScreen.draw, this.art, layer, this.pictures);
        break;
      case Scene.MENU:
        drawMenu(game, this.art, layer, this.over, this.pictures.title, this.menuCorner);
        break;
      case Scene.OPTIONS:
        drawOptions(game, this.art, layer, this.pictures.optionsBackdrop, this.drawnContext());
        break;
      case Scene.SELECT:
        drawSelect(game, this.data.scenes, this.data.roster, this.art, this.light, layer, this.pictures.select);
        break;
      case Scene.TIME_RESULTS:
        drawTimeResults(game, this.data.scenes, this.art, this.light, layer, { results: this.pictures.results, smallIcons: this.pictures.select.smallIcons });
        break;
      case Scene.TEAM_RESULTS:
        drawTeamResults(game, this.data.scenes, this.art, this.light, layer, this.pictures.select.smallIcons);
        break;
      case Scene.SURVIVAL_RESULTS:
        drawSurvivalResults(game, this.data.scenes, this.art, this.light, layer, this.pictures.select.smallIcons);
        break;
      case Scene.FORCE_RESULTS:
        drawForceResults(game, this.art, layer, { backdrop: this.pictures.forceResults, portraits: this.pictures.select.portraits, smallIcons: this.pictures.select.smallIcons });
        break;
      case Scene.VS_SELECT:
        drawVsSelect(game, this.data.scenes, this.art, this.light, layer, this.pictures.select.smallIcons);
        break;
      case Scene.VERSUS:
        drawVersus(game, this.art, this.light, layer, this.pictures.select.portraits, this.pictures.select.smallIcons);
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
    this.drawDissolve(width, height, now);
    if (ball) this.endOverBall(game, width / height);
    else this.end();
    return true;
  }

  /** The layers drawn with Tekken Ball's ball between the pictures and the text, all in one frame. */
  private endOverBall(game: GameState, aspect: number): void {
    const renderer = this.renderer;
    /* The pictures are drawn in the ball's frame, under it, and move as no camera does: a temporal resolve blends no frame before into it. */
    renderer.cameraCut();
    renderer.beginFrame([0, 0, 0]);
    this.art.end();
    this.light.end();
    if (this.ball === null) {
      const white = renderer.createSurfaceTexture(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), { colorSpace: 'linear', filter: 'nearest', mipmap: false, wrap: 'clamp' });
      this.ball = new BallView(renderer, this.data.ball, this.data.math, white);
    }
    this.ball.drawSelect(game.vsSelect.ball, game.world.match.ball.kind, aspect);
    renderer.endFrame();
    this.layer.end();
    this.over.end();
  }

  private drawnContext(): { pictures: DrawnPictures; options: SceneDrawingData['scenes']['options']; controllers: Controllers } {
    return { pictures: this.pictures.drawn, options: this.data.scenes.options, controllers: this.controllers };
  }

  /** Over the fight, what its mode drew of its own (practice's menus and HUD): the printer's runs and its draws, in the fight's units. */
  renderOverFight(game: Pick<GameState, 'printed' | 'drawn'>, width: number, height: number): void {
    if (game.printed.length === 0 && game.drawn.length === 0) return;
    this.fightLayer.begin(width, height);
    drawScene(game, this.fightLayer, this.drawnContext());
    this.fightLayer.end();
  }

  /** A dissolve over a frame the scenes did not draw (the fight's); nothing when none is under way. */
  renderDissolve(width: number, height: number, now: number): void {
    this.cover = null;
    this.last = null;
    this.movieDrawn = false;
    if (this.dissolve === null) return;
    if (this.begin(width, height)) return;
    this.drawDissolve(width, height, now);
    this.end();
  }
}
