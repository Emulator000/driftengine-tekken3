/**
 * A text field on a canvas, which has none of a page's own: a text, a caret and a selection (its
 * anchor the end that stays), and what each key does to them, on the engine's text model (each move
 * and rub-out on a whole character): the arrows, Home and End (with Shift, selecting), Backspace and
 * Delete, Ctrl (Command on a Mac) with A to select all, C to copy, X to cut and V to paste, and the
 * mouse placing the caret or dragging a selection. What a field takes (how long, which letters, in
 * capitals) is its `Bounds`, a pasted text kept to what it takes a letter at a time.
 *
 * The clipboard is the browser's: a copy, cut or paste key is let through to it, so its `copy`,
 * `cut` and `paste` events fire on the document with their data to read and write as they are,
 * asking no permission; where a paste brings no event, the clipboard's own reading answers.
 */
import { createTextModel, deleteBackward, deleteForward, insertText, moveCaret, moveToLineEdge, selectAll, selectionRange, type TextModel } from '@driftengine/ui2d';

/** A field's state: its text, the caret and the selection's other end (the caret's own place with none). */
export interface Field {
  readonly value: string;
  readonly caret: number;
  readonly anchor: number;
}

/** What a field takes: its most letters, the letters it takes (any printable without), and whether they fold to capitals. */
export interface Bounds {
  readonly max: number;
  readonly allow?: RegExp;
  readonly upper?: boolean;
}

/** A key as the browser gives it. */
export interface Keystroke {
  readonly key: string;
  /** Ctrl, or Command on a Mac. */
  readonly control: boolean;
  readonly shift: boolean;
}

export type ClipboardAsk = 'copy' | 'cut' | 'paste' | null;

/** A key's edit: the field after it, what it asks of the clipboard, and whether the field took the key at all. */
export interface Edited {
  readonly field: Field;
  readonly clipboard: ClipboardAsk;
  readonly took: boolean;
}

function modelOf(it: Field): TextModel {
  const model = createTextModel(it.value);
  model.caret = Math.min(it.caret, it.value.length);
  model.anchor = Math.min(it.anchor, it.value.length);
  return model;
}

const fieldOf = (model: TextModel): Field => ({ value: model.text, caret: model.caret, anchor: model.anchor });

/** The selection, in order (empty with none). */
export function selection(it: Field): { from: number; to: number } {
  return selectionRange(modelOf(it));
}

/** The selected text, or the whole text with none selected. */
export function copied(it: Field): string {
  const { from, to } = selection(it);
  return from < to ? it.value.slice(from, to) : it.value;
}

/** What of `text` the field takes, a letter at a time, in the room it has left. */
function accepted(text: string, bounds: Bounds, room: number): string {
  let out = '';
  for (const one of text) {
    const letter = bounds.upper === true ? one.toUpperCase() : one;
    if (bounds.allow !== undefined ? !bounds.allow.test(letter) : (letter.codePointAt(0) ?? 0) < 0x20) continue;
    if (out.length + letter.length > room) break;
    out += letter;
  }
  return out;
}

/** `text` over the selection, or at the caret. */
export function insert(it: Field, text: string, bounds: Bounds): Field {
  const { from, to } = selection(it);
  const model = modelOf(it);
  insertText(model, accepted(text, bounds, Math.max(0, bounds.max - (it.value.length - (to - from)))));
  return fieldOf(model);
}

/** A field holding what it takes of `text` alone, its caret at the end: a whole text typed elsewhere (a phone's own text box). */
export const replaced = (text: string, bounds: Bounds): Field => insert({ value: '', caret: 0, anchor: 0 }, text, bounds);

/** The caret put at `at`, the selection dragged there from its anchor when `extend`. */
export function placeCaret(it: Field, at: number, extend: boolean): Field {
  const caret = Math.max(0, Math.min(it.value.length, at));
  return { value: it.value, caret, anchor: extend ? it.anchor : caret };
}

/** One key against a field. */
export function edit(it: Field, stroke: Keystroke, bounds: Bounds): Edited {
  const took = (field: Field, clipboard: ClipboardAsk = null): Edited => ({ field, clipboard, took: true });
  const model = modelOf(it);
  if (stroke.control) {
    switch (stroke.key.toLowerCase()) {
      case 'a':
        selectAll(model);
        return took(fieldOf(model));
      case 'c':
        return took(it, 'copy');
      case 'x': {
        const { from, to } = selection(it);
        if (from < to) deleteBackward(model);
        return took(fieldOf(model), 'cut');
      }
      case 'v':
        return took(it, 'paste');
      default:
        return { field: it, clipboard: null, took: false };
    }
  }
  switch (stroke.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const by = stroke.key === 'ArrowLeft' ? -1 : 1;
      const { from, to } = selection(it);
      /* Out of a selection without Shift, to its end on that side. */
      if (from < to && !stroke.shift) return took(placeCaret(it, by < 0 ? from : to, false));
      moveCaret(model, by, stroke.shift);
      return took(fieldOf(model));
    }
    case 'Home':
    case 'End':
      moveToLineEdge(model, stroke.key === 'End', stroke.shift);
      return took(fieldOf(model));
    case 'Backspace':
      deleteBackward(model);
      return took(fieldOf(model));
    case 'Delete':
      deleteForward(model);
      return took(fieldOf(model));
  }
  /* A letter is one character; a key's name (Shift, F5, Process) is longer. */
  if ([...stroke.key].length === 1) return took(insert(it, stroke.key, bounds));
  return { field: it, clipboard: null, took: false };
}

/** The bounds of the page's fields: a room's code, a player's name, a server's address. */
export const codeBounds = (letters: string, length: number): Bounds => ({ max: length, allow: new RegExp(`^[${letters}]$`), upper: true });
export const nameBounds: Bounds = { max: 12, allow: /^[A-Z0-9 .-]$/, upper: true };
export const addressBounds: Bounds = { max: 96 };

/**
 * The browser's clipboard, for the fields: what a `paste` event brought, kept until a field takes
 * it, and a text set to go out on the next `copy` or `cut` event, as a key that asks for them is
 * let through; the clipboard's own reading and writing where an event does not come.
 */
export class ClipboardBridge {
  private pasted: string | null = null;
  private waiting = false;
  private outgoing = '';

  constructor(target: EventTarget = document) {
    target.addEventListener('paste', (event) => {
      const data = (event as ClipboardEvent).clipboardData;
      if (data === null || !this.waiting) return;
      this.pasted = data.getData('text/plain');
      this.waiting = false;
      event.preventDefault();
    });
    const out = (event: Event): void => {
      if (this.outgoing === '') return;
      (event as ClipboardEvent).clipboardData?.setData('text/plain', this.outgoing);
      event.preventDefault();
      this.outgoing = '';
    };
    target.addEventListener('copy', out);
    target.addEventListener('cut', out);
  }

  /** A paste asked for: its event's text, or, where none comes soon, the clipboard's own reading. */
  ask(): void {
    this.waiting = true;
    setTimeout(() => {
      if (!this.waiting) return;
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (this.waiting) this.pasted = text;
        })
        .catch(() => undefined)
        .finally(() => (this.waiting = false));
    }, 60);
  }

  /** Text for the clipboard: on the copy event the key brings, and through the clipboard's own writing too. */
  write(text: string): void {
    this.outgoing = text;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  /** What a paste brought since the last time, once. */
  take(): string | null {
    const text = this.pasted;
    this.pasted = null;
    return text;
  }
}
