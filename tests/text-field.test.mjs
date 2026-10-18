/**
 * ONLINE MODE's text fields (a room's code, the name, the server's address) edited as a page's text
 * box is: the caret moved and a selection made with the arrows, Shift and Home and End, Ctrl+A
 * selecting all, Ctrl+C copying the selection (or the whole text), Ctrl+X cutting it, Ctrl+V
 * pasting over it, a pasted text kept to what the field takes, the mouse's caret and drag.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressBounds, codeBounds, copied, edit, insert, nameBounds, placeCaret, replaced, selection } from '../src/app/text-field.ts';
import { CODE_LENGTH, CODE_LETTERS } from '../src/sim/game/online-page.ts';

const key = (k, { control = false, shift = false } = {}) => ({ key: k, control, shift });
const type = (field, text, bounds) => [...text].reduce((f, k) => edit(f, key(k), bounds).field, field);
const empty = { value: '', caret: 0, anchor: 0 };

test('typing, the arrows and Shift, Home and End, Backspace and Delete', () => {
  let f = type(empty, 'relay.example:8790', addressBounds);
  assert.deepEqual(f, { value: 'relay.example:8790', caret: 18, anchor: 18 });
  f = edit(f, key('Home')).field;
  assert.equal(f.caret, 0);
  f = edit(f, key('End', { shift: true }), addressBounds).field;
  assert.deepEqual(selection(f), { from: 0, to: 18 }, 'Shift+End selects to the end');
  f = edit(f, key('ArrowLeft'), addressBounds).field;
  assert.deepEqual(f, { value: 'relay.example:8790', caret: 0, anchor: 0 }, 'an arrow leaves a selection at its end on that side');
  f = edit(edit(f, key('ArrowRight', { shift: true }), addressBounds).field, key('ArrowRight', { shift: true }), addressBounds).field;
  assert.equal(copied(f), 're');
  f = edit(f, key('Delete'), addressBounds).field;
  assert.equal(f.value, 'lay.example:8790', 'Delete takes the selection');
  f = edit(edit(f, key('End'), addressBounds).field, key('Backspace'), addressBounds).field;
  assert.equal(f.value, 'lay.example:879');
});

test('Ctrl+A selects all, Ctrl+C copies, Ctrl+X cuts, Ctrl+V asks for a paste that replaces the selection', () => {
  const f = type(empty, 'wss://old.example/', addressBounds);
  const all = edit(f, key('a', { control: true }), addressBounds);
  assert.deepEqual(selection(all.field), { from: 0, to: 18 });
  assert.equal(edit(all.field, key('c', { control: true }), addressBounds).clipboard, 'copy');
  assert.equal(copied(all.field), 'wss://old.example/');
  assert.equal(copied(f), 'wss://old.example/', 'with nothing selected, the whole text');
  const cut = edit(all.field, key('x', { control: true }), addressBounds);
  assert.equal(cut.clipboard, 'cut');
  assert.equal(cut.field.value, '');
  const paste = edit(all.field, key('v', { control: true }), addressBounds);
  assert.equal(paste.clipboard, 'paste');
  assert.equal(paste.took, true);
  assert.equal(insert(paste.field, 'relay.example:8790\n', addressBounds).value, 'relay.example:8790', 'the line end left out');
});

test('each field takes what it takes: a code four of its letters in capitals; a name in capitals', () => {
  const code = codeBounds(CODE_LETTERS, CODE_LENGTH);
  assert.equal(insert(empty, ' ab-o1z9 k ', code).value, 'ABZ9', 'O and 1 refused (a code has neither), four at most');
  assert.equal(type(empty, 'hwoarang fan!', nameBounds).value, 'HWOARANG FAN');
  assert.equal(insert(empty, 'x'.repeat(200), addressBounds).value.length, 96);
});

test('the mouse puts the caret, Shift or a drag the selection to there', () => {
  const f = type(empty, 'localhost:8790', addressBounds);
  const pressed = placeCaret(f, 4, false);
  assert.deepEqual(pressed, { value: 'localhost:8790', caret: 4, anchor: 4 });
  const dragged = placeCaret(pressed, 9, true);
  assert.equal(copied(dragged), 'lhost');
  assert.deepEqual(placeCaret(f, 99, false), { value: 'localhost:8790', caret: 14, anchor: 14 });
});

test("a field given a whole text (a phone's own text box) holds what it takes of it, in capitals where it folds, its caret at the end", () => {
  assert.deepEqual(replaced('wss://relay.example:8790/', addressBounds), { value: 'wss://relay.example:8790/', caret: 25, anchor: 25 });
  assert.deepEqual(replaced('Mr. ok!_x', nameBounds), { value: 'MR. OKX', caret: 7, anchor: 7 }, 'letters it takes, in capitals');
  assert.equal(replaced('ABCDEFGHIJKLMNOP', nameBounds).value, 'ABCDEFGHIJKL', 'no more than its most');
  assert.deepEqual(replaced('', addressBounds), { value: '', caret: 0, anchor: 0 });
});
