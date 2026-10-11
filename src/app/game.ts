/**
 * The whole game, from power-on: the logo, the title, the menus and their fights, stepped from the
 * pads and each scene drawn from the game's state. A match's movesets are fetched as soon as its
 * characters are known; the game waits for them (its fields do not move on) if they are not in by
 * the time the match is set up, and holds the versus screen until the match's drawing is ready, as
 * the console held it while it read the fight from the disc (the attract intro and the records'
 * stage likewise, before their first frame).
 */
import { loadFightTables, loadIntroModels, loadMoveset } from '../assets/load.ts';
import { bindMoveIds, fightDataFor, matchMovesets, type MatchSetup } from '../sim/fight/match.ts';
import type { FightData, LoadedMoveset } from '../sim/fight/state.ts';
import { Game } from '../sim/game/game.ts';
import { Scene } from '../sim/game/state.ts';
import { FightStep, matchSetup } from '../sim/game/fight-scene.ts';
import { MenuMode } from '../sim/game/menu.ts';
import { checkSurvivalRecord, checkTimeRecord, recordStageTime } from '../sim/game/records.ts';
import { FightView } from '../present/3d/fight-view.ts';
import { Hud } from '../present/hud/hud.ts';
import { PauseScreen } from '../present/hud/pause.ts';
import { loadTypefaces } from '../present/2d/typefaces.ts';
import { ScenePresenter } from '../present/scenes/scenes.ts';
import { assetImage, canvas, dataUrl, json, pageRenderer, params, play, status, two } from './page.ts';
import { drawingFiles, introFiles } from './quick.ts';
import { startSound } from './sound.ts';
import { MoviePicture } from '../present/scenes/movie.ts';

/** The frames each of the ten stages takes in the time record `?record=time` sets. */
const RECORD_STAGE_FRAMES = 30 * 60;

export async function playGame(): Promise<void> {
  const { renderer, backend } = await pageRenderer();
  status.textContent = 'loading';
  const picture = (name: string): Promise<ImageBitmap> => assetImage(`pictures/${name}.png`);
  const names = ['title', 'namco', 'portraits', 'select-icons-big', 'select-icons-small', 'captions', 'credits-mark'] as const;
  const [[{ tables, arena, commands, scenes }, common, , introSet, introModels], pictures, sound] = await Promise.all([
    Promise.all([loadFightTables(json), loadMoveset(json, 'common'), loadTypefaces(), loadMoveset(json, 'intro'), loadIntroModels(json)]),
    Promise.all(names.map(picture)),
    startSound(),
  ]);
  const [title, namco, portraits, bigIcons, smallIcons, captions, creditsMark] = pictures as [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap];

  /* The movesets by id, fetched once each. */
  const movesets = new Map<number, LoadedMoveset>();
  const fetching = new Set<number>();
  const want = (id: number): LoadedMoveset | null => {
    const found = movesets.get(id);
    if (found !== undefined) return found;
    if (!fetching.has(id)) {
      fetching.add(id);
      void loadMoveset(json, two(id)).then((set) => movesets.set(id, set));
    }
    return null;
  };
  const matches = new Map<string, FightData>();
  const fightData = (setup: MatchSetup): FightData | null => {
    const [a, b] = matchMovesets(tables, setup);
    const key = `${a} ${b}`;
    const known = matches.get(key);
    if (known !== undefined) return known;
    const first = want(a);
    const second = b < 0 ? null : want(b);
    if (first === null || (b >= 0 && second === null)) return null;
    const data = fightDataFor(tables, setup, (id) => (id === a ? first : second!), common);
    matches.set(key, data);
    return data;
  };

  /* Each attract intro's data: its moveset in both slots, its models by pack. */
  const intros = new Map<number, FightData>();
  const introData = (intro: number): FightData => {
    let data = intros.get(intro);
    if (data === undefined) {
      const sets = [introSet, introSet, common] as const;
      data = { ...tables, models: introModels[intro]!, sets, moveIds: bindMoveIds(sets) };
      intros.set(intro, data);
    }
    return data;
  };

  const game = new Game({ tables, scenes, fightData, introData });
  /* `?ending=ROSTER[,COSTUME]` goes straight to that character's Arcade ending (the first side the one human). */
  const ending = params.get('ending');
  if (ending !== null) {
    const [roster, costume = 0] = ending.split(',').map(Number) as [number, number?];
    Object.assign(game.state, { scene: Scene.OVERLAY_LOADER, step: 0, next: Scene.MOVIE });
    game.state.world.humans = 1;
    game.state.world.fighters[0]!.rosterCode = roster * 4 + costume;
  }
  /*
   * `?record=time,ROSTER` goes straight to the records with that character's best time beaten on
   * the first side (ten stages of 30 seconds, as Time Attack leaves it), its name to enter;
   * `?record=survival,ROSTER,WINS` with a survival record of that many wins.
   */
  const record = params.get('record');
  if (record !== null) {
    const [kind, roster = 0, wins = 0] = record.split(',').map((part, i) => (i === 0 ? part : Number(part))) as [string, number?, number?];
    if (kind === 'survival') {
      game.state.world.mode = MenuMode.SURVIVAL;
      checkSurvivalRecord(game.state, scenes, 0, roster, wins);
    } else {
      game.state.world.mode = MenuMode.TIME_ATTACK;
      for (let stage = 0; stage < 10; stage += 1) recordStageTime(game.state, stage, roster, 0, 0, RECORD_STAGE_FRAMES);
      checkTimeRecord(game.state, scenes);
    }
    Object.assign(game.state, { scene: Scene.RECORDS_LOADER, step: 0 });
  }
  const movie = new MoviePicture(renderer, scenes.movies, (file) => dataUrl(`movies/${two(file)}.mp4`), (video) => sound?.connectMovie(video));
  movie.setCaptions(captions);
  const presenter = new ScenePresenter(renderer, { scenes, roster: tables.roster }, { title, namco, select: { portraits, bigIcons, smallIcons }, creditsMark }, movie);
  presenter.prepare(canvas.width, canvas.height);
  /* The fight's drawing, made with the first match and given each new match's data. */
  let fight: { view: FightView; hud: Hud; pause: PauseScreen; data: FightData } | null = null;
  const fightFor = (data: FightData): NonNullable<typeof fight> => {
    if (fight === null) fight = { view: new FightView(renderer, data, arena, drawingFiles), hud: new Hud(renderer, data, game.state.world), pause: new PauseScreen(renderer, data, commands), data };
    else if (fight.data !== data) {
      fight.view.data = data;
      fight.pause.data = data;
      fight.data = data;
    }
    return fight;
  };
  /* Each attract intro's drawing, made the first time it plays. */
  const introViews = new Map<number, FightView>();
  const introView = (intro: number): FightView => {
    let view = introViews.get(intro);
    if (view === undefined) {
      view = new FightView(renderer, introData(intro), arena, introFiles(intro, scenes.intros[intro]!.pairs));
      introViews.set(intro, view);
    }
    return view;
  };
  /** Whether the attract intro is set up (its world holds the intro's fighters and stage). */
  const introSetUp = (state: typeof game.state): boolean => state.scene === Scene.ATTRACT && state.step === 2 && state.attractScreen.step !== 0;
  /**
   * Whether the game may step on to show its 3D, whose drawing is asked for while it is not ready
   * (its models loaded, its pipelines compiled): the fight's over the versus screen's wait, the
   * wait's end held until it is, so the screen shows for the wait or the load, whichever is
   * longer; the attract intro's once it is set up; the records' stage as their screen starts.
   */
  const drawingReady = (): boolean => {
    const state = game.state;
    const data = game.fightData;
    if (state.scene === Scene.FIGHT && data !== null && (state.step === FightStep.WAIT || state.step === FightStep.HOLD)) {
      const { view, hud } = fightFor(data);
      /* The HUD's pictures painted now too, not on the fight's first frame. */
      hud.newMatch(data, state.world);
      hud.prepare(state.world, canvas.width, canvas.height);
      const ready = view.prepare(state.world);
      return state.step === FightStep.WAIT || ready;
    }
    if (introSetUp(state)) return introView(state.attract.intro).prepare(state.world);
    if (state.scene === Scene.RECORDS && data !== null) return fightFor(data).view.prepare(state.world, true);
    return true;
  };
  /* The fighters the HUD's names were set for; what the last frame drawn showed. */
  let named = '';
  let shown: string | null = null;

  play(
    {
      field(pads) {
        const next = game.upcoming();
        if (next !== null) fightData(next);
        if (game.blocked() || !drawingReady()) return false;
        game.field(pads);
        sound?.field(game.state.world, game.state.vblanks);
        movie.audible = sound?.running ?? false;
        movie.field(game.state);
        return true;
      },
      render(width, height) {
        const state = game.state;
        const now = performance.now() / 1000;
        const aspect = height > 0 ? width / height : 1;
        /* The records' stage is drawn by a fight's view: the last match's, or with none fought yet (`?ending`, `?record`) one for the entrants as they stand. */
        const data = game.fightData ?? (state.scene === Scene.RECORDS ? fightData(matchSetup(state)) : null);
        /* What this frame shows: the fight, the records over their stage, the attract intro, a scene's 2D; or nothing new (the picture held, drawn again only while a dissolve over it runs). */
        const records = state.scene === Scene.RECORDS && state.recordsScreen.draws !== 0 && data !== null && state.held === 0 && fightFor(data).view.prepare(state.world, true);
        const intro = introSetUp(state) && state.held === 0 && introView(state.attract.intro).prepare(state.world);
        const shows = state.scene === Scene.FIGHT ? (state.drewFight !== 0 && data !== null ? 'fight' : null) : records ? 'records' : intro ? 'intro' : state.held === 0 ? `scene ${state.scene}` : null;
        if (shows === null) {
          presenter.hold(width, height, now);
          return;
        }
        /* A cut: the frame before it dissolves into this one (from black after a 3D frame). */
        if (shown !== null && shows !== shown) presenter.cut(now, shown.startsWith('scene'));
        shown = shows;
        if (records) {
          fightFor(data!).view.render(state.world, aspect, undefined, () => presenter.render(state, width, height, true, now), true);
          return;
        }
        if (intro) {
          introView(state.attract.intro).render(state.world, aspect, undefined, () => presenter.render(state, width, height, true, now));
          return;
        }
        if (state.scene !== Scene.FIGHT) {
          presenter.render(state, width, height, false, now);
          return;
        }
        const { view, hud, pause } = fightFor(data!);
        const world = state.world;
        const fighters = `${world.fighters[0]!.rosterCode} ${world.fighters[1]!.rosterCode}`;
        if (named !== fighters) {
          named = fighters;
          hud.newMatch(data!, world);
        }
        hud.prepare(world, width, height);
        pause.prepare(world, width, height);
        view.render(
          world,
          aspect,
          () => hud.drawBack(),
          () => {
            hud.drawFront();
            pause.draw();
            presenter.renderDissolve(width, height, now);
          },
        );
      },
      moving: () => presenter.moving,
      probe: () => ({ scene: game.state.scene, sceneState: game.state.step, sound: sound?.probe() ?? null, movie: movie.probe() }),
    },
    backend,
  );
}
