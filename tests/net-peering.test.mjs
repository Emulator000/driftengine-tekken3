/**
 * The socket an online match's words go through: the server's until the direct channel opens, the
 * channel's alone then, and the server's again once the channel closes or is not trusted any more
 * (`relayToo`), so a channel gone quiet never holds both sides waiting while the server's own
 * messages still come; what arrives either way is heard.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { switchableSocket } from '../src/net/peering.ts';

function fakeSocket() {
  const sent = [];
  const listeners = [];
  return {
    sent,
    readyState: 1,
    binaryType: '',
    send(data) {
      sent.push(data);
    },
    close() {},
    addEventListener(type, listener) {
      listeners.push([type, listener]);
    },
    arrive(data) {
      for (const [type, listener] of listeners) if (type === 'message') listener({ data });
    },
  };
}

function fakeChannel() {
  const socket = fakeSocket();
  socket.readyState = 'open';
  return socket;
}

test('the words go through the server, then the open channel alone, then the server again once it closes', () => {
  const server = fakeSocket();
  const channel = fakeChannel();
  const wire = switchableSocket(server);
  const heard = [];
  wire.socket.addEventListener('message', (event) => heard.push(event.data));
  wire.socket.send(new Uint8Array([1]));
  assert.equal(wire.direct, false);
  wire.switchTo(channel);
  wire.socket.send(new Uint8Array([2]));
  assert.equal(wire.direct, true);
  assert.deepEqual([server.sent.length, channel.sent.length], [1, 1], 'the open channel alone');
  channel.readyState = 'closed';
  wire.socket.send(new Uint8Array([3]));
  assert.equal(wire.direct, false);
  assert.equal(wire.socket.readyState, 1, "the server's socket open still");
  assert.deepEqual([server.sent.length, channel.sent.length], [2, 1], 'the server again');
  server.arrive('by the server');
  channel.arrive('by the channel');
  assert.deepEqual(heard, ['by the server', 'by the channel']);
});

test('a channel not trusted any more: the words through both, the server and the channel, for good', () => {
  const server = fakeSocket();
  const channel = fakeChannel();
  const wire = switchableSocket(server);
  wire.switchTo(channel);
  wire.relayToo();
  wire.socket.send(new Uint8Array([1]));
  wire.socket.send(new Uint8Array([2]));
  assert.equal(wire.direct, false);
  assert.deepEqual([server.sent.length, channel.sent.length], [2, 2]);
});
