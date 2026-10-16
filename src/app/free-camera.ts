/**
 * A camera flown through the held fight, for looking at a frame up close (`P`): the fight's fields
 * stop, and the camera starts from the shot it was in. A drag with the left button turns it, with
 * the right or middle slides it across the view; the wheel moves it along its view; W A S D fly it,
 * Q and E sink and lift it; Shift goes four times as fast, Alt a quarter. `P` again gives the
 * camera back to the fight, which goes on from the field it stopped at.
 */
import type { Camera } from '@driftengine/core';
import { freeView } from '../present/3d/free-view.ts';

/** Radians a dragged pixel turns the view. */
const LOOK = 0.004;
/** Metres a second the keys fly it. */
const SPEED = 2.5;
/** Metres a dragged pixel slides it. */
const SLIDE = 0.004;
/** Metres a wheel's unit of scroll moves it (a notch is some hundred). */
const DOLLY = 0.002;
/** How far it may look up or down, radians. */
const MOST_PITCH = 1.55;

const FLY = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight']);

/** Whether the free camera may not be taken now (online play, which no side may hold, or a text being typed): told by what knows. */
export const freeCameraBarred = { now: (): boolean => false };

export class FreeCamera {
  private readonly position: [number, number, number] = [0, 0, 0];
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  /** The view's rows' lengths, the fight's stretch of the picture. */
  private readonly scale: [number, number, number] = [1, 1, 1];
  private readonly keys = new Set<string>();
  private drag: 'look' | 'slide' | null = null;
  /** Whether it is to take the camera from the next frame's shot. */
  private starting = false;
  private last = 0;

  constructor(element: HTMLElement) {
    addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyP' && !e.repeat) {
          if (freeCameraBarred.now() && !freeView.active) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          this.toggle();
          return;
        }
        if (!freeView.active || !FLY.has(e.code)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.keys.add(e.code);
      },
      { capture: true },
    );
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.drag = null;
    });
    element.addEventListener('pointerdown', (e) => {
      if (!freeView.active) return;
      this.drag = e.button === 0 ? 'look' : 'slide';
      element.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    element.addEventListener('pointerup', () => (this.drag = null));
    element.addEventListener('pointermove', (e) => {
      if (!freeView.active || this.drag === null) return;
      if (this.drag === 'look') {
        this.yaw += e.movementX * LOOK;
        this.pitch = Math.max(-MOST_PITCH, Math.min(MOST_PITCH, this.pitch - e.movementY * LOOK));
      } else {
        const k = SLIDE * this.pace();
        const [right, up] = [this.right(), this.up()];
        for (let i = 0; i < 3; i += 1) this.position[i]! += -right[i]! * e.movementX * k + up[i]! * e.movementY * k;
      }
    });
    element.addEventListener('contextmenu', (e) => {
      if (freeView.active) e.preventDefault();
    });
    element.addEventListener(
      'wheel',
      (e) => {
        if (!freeView.active) return;
        e.preventDefault();
        const forward = this.forward();
        const step = -e.deltaY * DOLLY * this.pace();
        for (let i = 0; i < 3; i += 1) this.position[i]! += forward[i]! * step;
      },
      { passive: false },
    );
    freeView.apply = (camera, aspect) => this.apply(camera, aspect);
  }

  /** Take the camera from the shot it is in, or give it back. */
  toggle(): void {
    freeView.active = !freeView.active;
    this.keys.clear();
    this.drag = null;
    this.starting = freeView.active;
    this.last = performance.now();
  }

  /** Fly by the keys held since the last frame, and aim the camera (the fight's shot just taken into it). */
  private apply(camera: Camera, aspect: number): void {
    const now = performance.now();
    const seconds = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.starting) {
      this.starting = false;
      this.take(camera.view);
    }
    const step = SPEED * this.pace() * seconds;
    const along = (this.held('KeyW') - this.held('KeyS')) * step;
    const across = (this.held('KeyD') - this.held('KeyA')) * step;
    const rise = (this.held('KeyE') - this.held('KeyQ')) * step;
    const [forward, right] = [this.forward(), this.right()];
    for (let i = 0; i < 3; i += 1) this.position[i]! += forward[i]! * along + right[i]! * across;
    this.position[1] += rise;
    camera.position[0] = this.position[0];
    camera.position[1] = this.position[1];
    camera.position[2] = this.position[2];
    freeView.eye[0] = this.position[0];
    freeView.eye[1] = this.position[1];
    freeView.eye[2] = this.position[2];
    camera.yaw = this.yaw;
    camera.pitch = this.pitch;
    camera.roll = this.roll;
    camera.updateMatrices(aspect);
    const view = camera.view;
    for (let i = 0; i < 3; i += 1) for (let c = 0; c < 4; c += 1) view[c * 4 + i]! *= this.scale[i]!;
    camera.adoptView(view, camera.projection);
    /* Where it stands, which the engine cannot read off rows scaled apart. */
    camera.position[0] = this.position[0];
    camera.position[1] = this.position[1];
    camera.position[2] = this.position[2];
  }

  /**
   * The pose of a view matrix (column-major), whose rows may be scaled apart (the fight's stretches
   * the picture's height): the scale kept for every frame flown, the eye and the aim from the rest.
   */
  private take(view: ArrayLike<number>): void {
    const rows = [0, 1, 2].map((i) => [view[i]!, view[4 + i]!, view[8 + i]!]);
    for (let i = 0; i < 3; i += 1) {
      this.scale[i] = Math.hypot(...rows[i]!) || 1;
      rows[i] = rows[i]!.map((v) => v / this.scale[i]!);
    }
    const t = [0, 1, 2].map((i) => view[12 + i]! / this.scale[i]!);
    for (let j = 0; j < 3; j += 1) this.position[j] = -(rows[0]![j]! * t[0]! + rows[1]![j]! * t[1]! + rows[2]![j]! * t[2]!);
    const [bx, by, bz] = rows[2]!;
    this.yaw = Math.atan2(-bx!, bz!);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, -by!)));
    /* The roll: how far its right axis turns from the level one toward its up. */
    const [right, up] = [this.right(), this.up()];
    const r = rows[0]!;
    this.roll = Math.atan2(r[0]! * up[0]! + r[1]! * up[1]! + r[2]! * up[2]!, r[0]! * right[0]! + r[1]! * right[1]! + r[2]! * right[2]!);
  }

  private held(code: string): number {
    return this.keys.has(code) ? 1 : 0;
  }

  /** Four times as fast with Shift, a quarter with Alt. */
  private pace(): number {
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const slow = this.keys.has('AltLeft') || this.keys.has('AltRight');
    return fast ? 4 : slow ? 0.25 : 1;
  }

  /** Yaw 0 looks toward -Z, a positive yaw turns toward +X, a positive pitch looks up. */
  private forward(): [number, number, number] {
    const c = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c];
  }

  private right(): [number, number, number] {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }

  private up(): [number, number, number] {
    const s = Math.sin(this.pitch);
    return [-Math.sin(this.yaw) * s, Math.cos(this.pitch), Math.cos(this.yaw) * s];
  }
}
