/**
 * The pad on a touch screen, over the picture, as the first player's: a stick where the left thumb
 * lands, the four buttons on the right in a diamond as the pad's face buttons, named as the game
 * names them (2 above, 1 and 4 either side, 3 below: triangle, square, circle, cross), Select and
 * Start between the thumbs. Several fingers hold at once; a finger sliding from one button to
 * another holds the one it is on, and a thumb between two neighbours holds both.
 *
 * Shown where the screen is touched with fingers or the page runs on a phone, while no gamepad is
 * connected (`touchShown`): `?touch=1` or TOUCH PAD ON shows it anywhere and always, `?touch=0`
 * or OFF hides it, except on a phone with no gamepad. The first touch takes the page to full
 * screen, turned to landscape, where the browser lets it.
 */
import { DOWN, LEFT, RIGHT, UP } from './input.ts';
import { asked, settings } from './settings.ts';

/** How far the thumb moves from where it landed, as a share of the stick's radius, before it is a direction. */
const DEAD = 0.35;
/** The stick's radius, the buttons' size and the gap between them, CSS pixels. */
const STICK = 64;
const BUTTON = 72;
const GAP = 12;
/** How far from a button's middle a finger still holds it, as a share of its size: a thumb between two neighbours holds both, the diamond's middle neither. */
const REACH = 0.62;
/** The controls' colours: an edge, a button at rest, one held, a label. */
const LINE = 'rgba(255, 255, 255, 0.45)';
const SHADE = 'rgba(0, 0, 0, 0.3)';
const LIT = 'rgba(255, 255, 255, 0.45)';
const TEXT = 'rgba(255, 255, 255, 0.85)';
/** A disc placed by its centre, which the touch does not reach. */
const ROUND: Partial<CSSStyleDeclaration> = { position: 'absolute', borderRadius: '50%', pointerEvents: 'none' };

/** The face buttons: label, pad bits, and where each sits in the diamond (across, down). */
const FACE = [
  ['2', 0x10, 0, -1],
  ['1', 0x80, -1, 0],
  ['4', 0x20, 1, 0],
  ['3', 0x40, 0, 1],
] as const;
/** How far each face button sits from the diamond's middle: neighbours `GAP` apart. */
const SPREAD = (BUTTON + GAP) / Math.SQRT2;
const MIDDLE = [
  ['SELECT', 0x100],
  ['START', 0x800],
] as const;
/** The stick's eight ways, counterclockwise from right. */
const WAYS = [RIGHT, UP | RIGHT, UP, UP | LEFT, LEFT, DOWN | LEFT, DOWN, DOWN | RIGHT] as const;

/**
 * The pad's direction for a thumb `dx` right and `dy` down of where it landed, `radius` the
 * stick's: one of eight ways, 45 degrees each around its direction, or none within the dead zone.
 */
export function stickWord(dx: number, dy: number, radius: number): number {
  if (Math.hypot(dx, dy) <= DEAD * radius) return 0;
  const sector = (((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return WAYS[sector];
}

/** Whether the page runs on a phone or a tablet. */
export function onPhone(): boolean {
  const hints = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (hints.userAgentData?.mobile === true || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return true;
  /* An iPad asks for the desktop page, as a Mac with a touch screen. */
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

/** TOUCH PAD's choice, as the address (`?touch=1` or `0`) or REMAKE OPTION gives it: `'1'` on, `'0'` off, null for AUTO. */
export const touchChoice = (params: URLSearchParams): string | null => asked(params, 'touch', settings.touchPad, [null, '1', '0']);

/** The device the page runs on, as the touch pad's showing goes by it. */
export interface TouchDevice {
  readonly phone: boolean;
  readonly touchScreen: boolean;
}

export const touchDevice = (): TouchDevice => ({ phone: onPhone(), touchScreen: matchMedia('(pointer: coarse)').matches });

/**
 * Whether the touch pad shows: always where TOUCH PAD is ON; on a phone while no gamepad is
 * connected, whatever TOUCH PAD says, so a phone is never left with nothing to play on; and, in
 * AUTO, on a touch screen while no gamepad is.
 */
export function touchShown(choice: string | null, device: TouchDevice, gamepad: boolean): boolean {
  if (choice === '1') return true;
  if (device.phone && !gamepad) return true;
  return choice === null && (device.phone || device.touchScreen) && !gamepad;
}

interface Button {
  readonly bits: number;
  readonly element: HTMLElement;
}

export class TouchPad {
  private readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: Button[] = [];
  /** The stick's finger, where it landed and where it is. */
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  /** Each button finger and the buttons it holds. */
  private readonly fingers = new Map<number, number>();
  private wentFull = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = element({ position: 'fixed', inset: '0', zIndex: '20', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none' });
    this.base = element({ ...ROUND, width: `${STICK * 2}px`, height: `${STICK * 2}px`, margin: `-${STICK}px 0 0 -${STICK}px`, border: `2px solid ${LINE}`, background: SHADE, display: 'none' });
    this.knob = element({ ...ROUND, width: '56px', height: '56px', margin: '-28px 0 0 -28px', background: LIT, display: 'none' });
    /* The right thumb's buttons, bottom right; Select and Start bottom centre, clear of the HUD and both thumbs. */
    const across = 2 * SPREAD + BUTTON;
    const face = element({ position: 'absolute', right: 'max(16px, env(safe-area-inset-right))', bottom: 'max(16px, env(safe-area-inset-bottom))', width: `${across}px`, height: `${across}px`, pointerEvents: 'none' });
    const middle = element({ position: 'absolute', bottom: 'max(10px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: `${GAP * 2}px`, pointerEvents: 'none' });
    for (const [label, bits, x, y] of FACE) {
      const b = element({ position: 'absolute', left: `${SPREAD * (1 + x)}px`, top: `${SPREAD * (1 + y)}px`, width: `${BUTTON}px`, height: `${BUTTON}px`, borderRadius: '50%', border: `2px solid ${LINE}`, background: SHADE, color: TEXT, font: `600 ${BUTTON / 3}px system-ui, sans-serif`, display: 'flex', alignItems: 'center', justifyContent: 'center' });
      b.textContent = label;
      face.append(b);
      this.buttons.push({ bits, element: b });
    }
    for (const [label, bits] of MIDDLE) {
      const b = element({ padding: '0 14px', height: '34px', borderRadius: '17px', border: `2px solid ${LINE}`, background: SHADE, color: TEXT, font: '600 12px system-ui, sans-serif', letterSpacing: '0.08em', display: 'flex', alignItems: 'center' });
      b.textContent = label;
      middle.append(b);
      this.buttons.push({ bits, element: b });
    }
    this.root.append(this.base, this.knob, face, middle);
    parent.append(this.root);
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    for (const end of ['pointerup', 'pointercancel'] as const) this.root.addEventListener(end, (e) => this.up(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The pad shown or hidden, letting go of what its fingers held as it hides; whether it has just come back. */
  show(shown: boolean): boolean {
    const was = this.root.style.display !== 'none';
    if (shown === was) return false;
    this.root.style.display = shown ? '' : 'none';
    if (!shown) {
      this.stick = null;
      this.fingers.clear();
      this.base.style.display = this.knob.style.display = 'none';
      this.light();
    }
    return shown;
  }

  /** The pad word the fingers hold. */
  word(): number {
    let held = 0;
    for (const bits of this.fingers.values()) held |= bits;
    const s = this.stick;
    return s === null ? held : held | stickWord(s.x - s.x0, s.y - s.y0, STICK);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* A pointer the browser no longer tracks: its moves still reach the layer. */
    }
    const bits = this.under(e.clientX, e.clientY);
    if (bits === 0 && e.clientX < innerWidth / 2 && this.stick === null) {
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.base.style.display = this.knob.style.display = 'block';
      this.place();
      return;
    }
    this.fingers.set(e.pointerId, bits);
    this.light();
  }

  private move(e: PointerEvent): void {
    const s = this.stick;
    if (s !== null && s.id === e.pointerId) {
      s.x = e.clientX;
      s.y = e.clientY;
      this.place();
      return;
    }
    if (!this.fingers.has(e.pointerId)) return;
    this.fingers.set(e.pointerId, this.under(e.clientX, e.clientY));
    this.light();
  }

  private up(e: PointerEvent): void {
    /* A finger lifted is the gesture a browser grants full screen to. */
    this.full();
    if (this.stick?.id === e.pointerId) {
      this.stick = null;
      this.base.style.display = this.knob.style.display = 'none';
      return;
    }
    if (this.fingers.delete(e.pointerId)) this.light();
  }

  /** The buttons a finger at (x, y) covers: the one it is on, or both where it lies between two. */
  private under(x: number, y: number): number {
    let bits = 0;
    for (const b of this.buttons) {
      const r = b.element.getBoundingClientRect();
      const dx = Math.max(0, Math.abs(x - (r.left + r.width / 2)) - (r.width - r.height) / 2);
      if (Math.hypot(dx, y - (r.top + r.height / 2)) <= r.height * REACH) bits |= b.bits;
    }
    return bits;
  }

  private place(): void {
    const s = this.stick;
    if (s === null) return;
    const dx = s.x - s.x0;
    const dy = s.y - s.y0;
    const reach = Math.min(1, STICK / (Math.hypot(dx, dy) || 1));
    this.base.style.left = `${s.x0}px`;
    this.base.style.top = `${s.y0}px`;
    this.knob.style.left = `${s.x0 + dx * reach}px`;
    this.knob.style.top = `${s.y0 + dy * reach}px`;
  }

  /** Show the buttons held. */
  private light(): void {
    let held = 0;
    for (const bits of this.fingers.values()) held |= bits;
    for (const b of this.buttons) b.element.style.background = held & b.bits ? LIT : SHADE;
  }

  /** Full screen and landscape, once: a browser grants both only to a gesture, and an app's view may grant neither. */
  private full(): void {
    if (this.wentFull) return;
    this.wentFull = true;
    const doc = document.documentElement;
    if (document.fullscreenElement !== null || doc.requestFullscreen === undefined) return;
    doc
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  }
}

function element(style: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement('div');
  Object.assign(e.style, style);
  return e;
}
