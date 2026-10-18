/**
 * A text entered on a touch screen. While ONLINE MODE's page edits one (the server's address, the
 * name, a room's code), a text box of the page's own stands over the picture holding it: a tap opens
 * the system's keyboard on it, a long press offers the system's paste, and what it holds is the
 * field's, kept to what the field takes. Its Enter (Done) keeps the text as the game's Enter does,
 * its Escape leaves it as the game's Escape does.
 */
import { replaced, type Bounds, type Field } from './text-field.ts';

/** What the box asks of the page: the field and what it takes, the field rewritten, and Enter or Escape. */
export interface TypingHooks {
  field(): Field;
  setField(field: Field): void;
  bounds(): Bounds;
  ended(kept: boolean): void;
}

/** What is being entered, as the box names it, and how the system's keyboard should come up for it. */
export interface Typed {
  readonly label: string;
  readonly address: boolean;
}

export class TouchTyping {
  private readonly hooks: TypingHooks;
  private readonly input: HTMLInputElement;
  private shown: Typed | null = null;

  constructor(hooks: TypingHooks) {
    this.hooks = hooks;
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.enterKeyHint = 'done';
    input.setAttribute('autocorrect', 'off');
    Object.assign(input.style, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(90vw, 560px)',
      boxSizing: 'border-box',
      padding: '10px 14px',
      font: "18px 'Russo One', sans-serif",
      color: '#fff',
      background: 'rgba(8, 10, 20, 0.88)',
      border: '2px solid #e8b030',
      borderRadius: '6px',
      outline: 'none',
      zIndex: '50',
      display: 'none',
    });
    input.addEventListener('input', () => {
      const field = replaced(input.value, this.hooks.bounds());
      this.hooks.setField(field);
      if (field.value !== input.value) input.value = field.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      this.hooks.ended(event.key === 'Enter');
      input.blur();
    });
    document.body.append(input);
    this.input = input;
  }

  /** Whether a key comes from the box: the box's own, not the game's. */
  owns(target: EventTarget | null): boolean {
    return target === this.input;
  }

  /** Each field: the box shown over the picture while `typed` is entered (null, none), holding the field's text while it is not being typed in. */
  frame(typed: Typed | null): void {
    if (typed === null) {
      if (this.shown === null) return;
      this.shown = null;
      this.input.blur();
      this.input.style.display = 'none';
      return;
    }
    if (this.shown === null || this.shown.label !== typed.label) {
      this.shown = typed;
      this.input.placeholder = typed.label;
      this.input.inputMode = typed.address ? 'url' : 'text';
      this.input.autocapitalize = typed.address ? 'off' : 'characters';
      this.input.style.display = 'block';
      this.input.value = this.hooks.field().value;
      /* Where the system lets a page open its keyboard so, at once; elsewhere a tap on the box does. */
      this.input.focus({ preventScroll: true });
    }
    if (document.activeElement !== this.input) {
      const value = this.hooks.field().value;
      if (this.input.value !== value) this.input.value = value;
    }
  }
}
