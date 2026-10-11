/**
 * Keyboards and gamepads as the console's pad words. Player 1: WASD to move, U I J K for left
 * punch, right punch, left kick, right kick, Q and E the sidestep shoulders, Enter start. Player 2:
 * the arrows, numpad 4 5 1 2, numpad 7 and 9, numpad Enter. A standard gamepad drives the player
 * of its index.
 */
export const UP = 0x1000;
export const RIGHT = 0x2000;
export const DOWN = 0x4000;
export const LEFT = 0x8000;

const KEYS: readonly Record<string, number>[] = [
  { KeyW: UP, KeyD: RIGHT, KeyS: DOWN, KeyA: LEFT, KeyU: 0x80, KeyI: 0x10, KeyJ: 0x40, KeyK: 0x20, KeyQ: 0x01, KeyE: 0x04, Enter: 0x800 },
  { ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT, Numpad4: 0x80, Numpad5: 0x10, Numpad1: 0x40, Numpad2: 0x20, Numpad7: 0x01, Numpad9: 0x04, NumpadEnter: 0x800 },
];
/** A standard gamepad's buttons as the pad's bits. */
const GAMEPAD_BITS = [0x40, 0x20, 0x80, 0x10, 0x04, 0x08, 0x01, 0x02, 0x100, 0x800, 0, 0, UP, DOWN, LEFT, RIGHT];

export class PadInput {
  private readonly held = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (KEYS.some((keys) => e.code in keys)) e.preventDefault();
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
      gamepad.buttons.forEach((b, i) => {
        if (b.pressed) word |= GAMEPAD_BITS[i] ?? 0;
      });
      const [x = 0, y = 0] = gamepad.axes;
      if (x < -0.5) word |= LEFT;
      if (x > 0.5) word |= RIGHT;
      if (y < -0.5) word |= UP;
      if (y > 0.5) word |= DOWN;
    }
    return word;
  }
}
