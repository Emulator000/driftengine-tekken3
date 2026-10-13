/**
 * The pads' vibration felt on the gamepads: each field, what the game's driver says each pad feels
 * (its small motor on or off, its large motor's strength) played on the gamepad of that player's
 * index as the browser's two motors (the weak one for the small, the strong one for the large),
 * a short effect sent again only when it changes or runs out, so a page that stops stepping stops
 * the motors at once. Where a browser has no gamepad motors, nothing is felt.
 */

/** How long each effect sent lasts (three fields), and how soon before its end the same one is sent again. */
const HOLD_MS = 50;
const AHEAD_MS = 17;

interface Actuator {
  playEffect(type: 'dual-rumble', params: { startDelay: number; duration: number; weakMagnitude: number; strongMagnitude: number }): Promise<unknown>;
  reset?(): Promise<unknown>;
}

export class Rumble {
  /** Per pad: what it was last sent and when. */
  private readonly sent = [
    { small: 0, large: 0, at: 0 },
    { small: 0, large: 0, at: 0 },
  ];

  constructor(target: Window) {
    const stop = (): void => this.stop();
    target.addEventListener('blur', stop);
    target.addEventListener('gamepaddisconnected', stop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
    });
  }

  /** A field's motors, `out[pad]` the small motor (0 or 1) and the large (0 to 255), at `now` (ms). */
  field(out: readonly (readonly number[])[], now: number): void {
    out.forEach(([small = 0, large = 0], pad) => {
      const actuator = actuatorOf(pad);
      const sent = this.sent[pad];
      if (actuator === null || sent === undefined) return;
      if (small === 0 && large === 0) {
        if (sent.small !== 0 || sent.large !== 0) void actuator.reset?.().catch(() => {});
        Object.assign(sent, { small: 0, large: 0, at: 0 });
        return;
      }
      if (small === sent.small && large === sent.large && now < sent.at + HOLD_MS - AHEAD_MS) return;
      void actuator.playEffect('dual-rumble', { startDelay: 0, duration: HOLD_MS, weakMagnitude: small !== 0 ? 1 : 0, strongMagnitude: large / 255 }).catch(() => {});
      Object.assign(sent, { small, large, at: now });
    });
  }

  /** Every gamepad's motors stopped. */
  stop(): void {
    this.sent.forEach((sent, pad) => {
      if (sent.small !== 0 || sent.large !== 0) void actuatorOf(pad)?.reset?.().catch(() => {});
      Object.assign(sent, { small: 0, large: 0, at: 0 });
    });
  }
}

/** The motors of the gamepad a player plays on, if it has them. */
function actuatorOf(pad: number): Actuator | null {
  const gamepad = navigator.getGamepads?.()[pad] as (Gamepad & { vibrationActuator?: Actuator | null }) | null | undefined;
  const actuator = gamepad?.vibrationActuator;
  return actuator !== undefined && actuator !== null && typeof actuator.playEffect === 'function' ? actuator : null;
}
