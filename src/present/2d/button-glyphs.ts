/**
 * A controller's button painted new: a face button as a disc (a letter in its colour on an Xbox
 * pad, white on a Nintendo pad, a number on the touch pad, a PlayStation symbol in its colour), a
 * shoulder or a middle button as a rounded tab with its name, a key as a cap.
 */
import { Bit, buttonName, FACE, type Controller } from './controls.ts';
import { DISPLAY } from './typefaces.ts';

/** An Xbox pad's letters' colours. */
const XBOX = { A: '#62b146', B: '#e0403a', X: '#3a86e0', Y: '#ecbd2c' } as const;
/** The PlayStation symbols' colours, for a face button painted new. */
const SYMBOLS = { [Bit.TRIANGLE]: '#3fd0a0', [Bit.CIRCLE]: '#f05a5a', [Bit.CROSS]: '#7f9cf0', [Bit.SQUARE]: '#e88ad8' } as const;

/** A button painted in a box (device pixels). */
export function paintButton(g: OffscreenCanvasRenderingContext2D, controller: Controller, bit: number, left: number, top: number, w: number, h: number): void {
  const name = buttonName(controller, bit);
  const middle = { x: left + w / 2, y: top + h / 2 };
  const text = (colour: string, size: number): void => {
    g.fillStyle = colour;
    g.font = `700 ${size}px "${DISPLAY.family}", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, middle.x, middle.y + size * 0.05, w * 0.9);
  };
  if (controller.kind === 'keyboard') {
    const r = Math.min(w, h) * 0.18;
    g.beginPath();
    g.roundRect(left + w * 0.04, top + h * 0.04, w * 0.92, h * 0.92, r);
    g.fillStyle = '#e8e8e8';
    g.fill();
    g.lineWidth = Math.max(1, h * 0.06);
    g.strokeStyle = '#5a5a5a';
    g.stroke();
    text('#161616', Math.min(h * 0.62, (w * 1.3) / Math.max(1, name.length)));
    return;
  }
  if (!FACE.has(bit)) {
    g.beginPath();
    g.roundRect(left + w * 0.04, top + h * 0.12, w * 0.92, h * 0.76, h * 0.38);
    g.fillStyle = '#262626';
    g.fill();
    g.lineWidth = Math.max(1, h * 0.06);
    g.strokeStyle = '#bcbcbc';
    g.stroke();
    text('#f0f0f0', Math.min(h * 0.5, (w * 1.2) / Math.max(1, name.length)));
    return;
  }
  const radius = Math.min(w, h) * 0.46;
  g.beginPath();
  g.arc(middle.x, middle.y, radius, 0, Math.PI * 2);
  g.fillStyle = controller.kind === 'touch' ? 'rgba(255, 255, 255, 0.85)' : '#1c1c1c';
  g.fill();
  g.lineWidth = Math.max(1, radius * 0.12);
  g.strokeStyle = controller.kind === 'touch' ? '#ffffff' : '#9a9a9a';
  g.stroke();
  if (controller.kind === 'playstation') {
    symbol(g, bit, middle.x, middle.y, radius * 0.55);
    return;
  }
  const colour = controller.kind === 'xbox' ? XBOX[name as keyof typeof XBOX] : controller.kind === 'touch' ? '#161616' : '#f4f4f4';
  text(colour, radius * 1.3);
}

/** A PlayStation face button's symbol, `r` its half size, around a point. */
function symbol(g: OffscreenCanvasRenderingContext2D, bit: number, x: number, y: number, r: number): void {
  g.strokeStyle = SYMBOLS[bit as keyof typeof SYMBOLS] ?? '#ffffff';
  g.lineWidth = Math.max(1, r * 0.3);
  g.beginPath();
  if (bit === Bit.TRIANGLE) {
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.95, y + r * 0.7);
    g.lineTo(x - r * 0.95, y + r * 0.7);
    g.closePath();
  } else if (bit === Bit.CIRCLE) g.arc(x, y, r * 0.85, 0, Math.PI * 2);
  else if (bit === Bit.CROSS) {
    g.moveTo(x - r * 0.8, y - r * 0.8);
    g.lineTo(x + r * 0.8, y + r * 0.8);
    g.moveTo(x + r * 0.8, y - r * 0.8);
    g.lineTo(x - r * 0.8, y + r * 0.8);
  } else g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
  g.stroke();
}
