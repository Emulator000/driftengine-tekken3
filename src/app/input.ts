/**
 * Keyboards and gamepads as the console's pad words. Player 1: WASD to move, U I J K for left
 * punch, right punch, left kick, right kick, Q and E the left shoulders (L2, L1), R and F the right
 * (R1, R2), Enter start, Backspace select. Player 2: the arrows, numpad 4 5 1 2, numpad 7 and 9,
 * numpad 6 and 3, numpad Enter, numpad's point. A standard gamepad drives the player of its index.
 * Alt+Enter takes the page to full screen and back, pressing no Start. Each player's controller is
 * the one it last pressed anything on (a keyboard, the touch pad, or a gamepad of the family its
 * name gives), for the glyphs and words the game shows it.
 */
import type { Controller, ControllerKind, Controllers } from '../present/2d/controls.ts';

export const UP = 0x1000;
export const RIGHT = 0x2000;
export const DOWN = 0x4000;
export const LEFT = 0x8000;

const KEYS: readonly Record<string, number>[] = [
  { KeyW: UP, KeyD: RIGHT, KeyS: DOWN, KeyA: LEFT, KeyU: 0x80, KeyI: 0x10, KeyJ: 0x40, KeyK: 0x20, KeyQ: 0x01, KeyE: 0x04, KeyR: 0x08, KeyF: 0x02, Enter: 0x800, Backspace: 0x100 },
  { ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT, Numpad4: 0x80, Numpad5: 0x10, Numpad1: 0x40, Numpad2: 0x20, Numpad7: 0x01, Numpad9: 0x04, Numpad6: 0x08, Numpad3: 0x02, NumpadEnter: 0x800, NumpadDecimal: 0x100 },
];
/** A standard gamepad's buttons as the pad's bits. */
const GAMEPAD_BITS = [0x40, 0x20, 0x80, 0x10, 0x04, 0x08, 0x01, 0x02, 0x100, 0x800, 0, 0, UP, DOWN, LEFT, RIGHT];
/** The keys' names as a keyboard shows them, where the code does not say it plainly. */
const KEY_NAMES: Readonly<Record<string, string>> = { Enter: 'ENTER', NumpadEnter: 'ENTER', Backspace: 'BACKSPACE', NumpadDecimal: 'DEL' };

/** The family a gamepad's name gives (one of none plays with the standard mapping's own letters, an Xbox pad's). */
function familyOf(id: string): ControllerKind {
  if (/054c|playstation|dualshock|dualsense|wireless controller/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** A player's keyboard: the key each of the pad's buttons is on, by name. */
function keyboardOf(player: number): Controller {
  const keys: Record<number, string> = {};
  for (const [code, bit] of Object.entries(KEYS[player] ?? {})) keys[bit] = KEY_NAMES[code] ?? code.replace(/^Key/, '').replace(/^Numpad/, '');
  return { kind: 'keyboard', keys };
}

export class PadInput {
  private readonly held = new Set<string>();
  /** Each player's controller, as it last pressed anything; the player who last did. */
  private readonly kinds: ControllerKind[] = ['keyboard', 'keyboard'];
  private last = 0;
  private readonly keyboards = [keyboardOf(0), keyboardOf(1)];

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.altKey && e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) fullScreen();
        return;
      }
      KEYS.forEach((keys, player) => {
        if (!(e.code in keys)) return;
        e.preventDefault();
        this.kinds[player] = 'keyboard';
        this.last = player;
      });
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Player `player`'s pad word this field. */
  word(player: number): number {
    let word = 0;
    for (const [code, bit] of Object.entries(KEYS[player] ?? {})) if (this.held.has(code)) word |= bit;
    const gamepad = navigator.getGamepads?.()[player];
    if (gamepad) {
      let pad = 0;
      gamepad.buttons.forEach((b, i) => {
        if (b.pressed) pad |= GAMEPAD_BITS[i] ?? 0;
      });
      const [x = 0, y = 0] = gamepad.axes;
      if (x < -0.5) pad |= LEFT;
      if (x > 0.5) pad |= RIGHT;
      if (y < -0.5) pad |= UP;
      if (y > 0.5) pad |= DOWN;
      if (pad !== 0) this.uses(player, familyOf(gamepad.id));
      word |= pad;
    }
    return word;
  }

  /** A player plays on a controller (the touch pad, which the page reads apart). */
  uses(player: number, kind: ControllerKind): void {
    this.kinds[player] = kind;
    this.last = player;
  }

  /** Both players' controllers as they last played. */
  controllers(): Controllers {
    const of = (player: number): Controller => (this.kinds[player] === 'keyboard' ? this.keyboards[player]! : { kind: this.kinds[player]!, keys: {} });
    return { players: [of(0), of(1)], last: this.last };
  }
}

/** The page to full screen, or back from it. */
function fullScreen(): void {
  if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
}
