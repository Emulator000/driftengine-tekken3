/**
 * The addresses a page tries for its online server, in turn: as typed with its way; a bare
 * `host:port` the page's own way first and then the other (secure then plain in an app's secure
 * page, whose home network's server has no certificate); none typed, the server beside the page,
 * but not beside the Android app's own origin.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { serverAddresses } from '../src/net/address.ts';

const plain = { protocol: 'http:', host: '192.168.1.16:5191' };
const secure = { protocol: 'https:', host: 'pc.local:5190' };
const app = { protocol: 'https:', host: 'appassets.androidplatform.net' };
const desktop = { protocol: 'file:', host: '' };

test("a server typed with its way is taken as it is, an HTTP address as a WebSocket's", () => {
  assert.deepEqual(serverAddresses('wss://relay.example/', app), ['wss://relay.example/']);
  assert.deepEqual(serverAddresses(' ws://192.168.1.16:8790 ', app), ['ws://192.168.1.16:8790'], 'a plain one even from a secure page, which may refuse it');
  assert.deepEqual(serverAddresses('https://relay.example/t3', plain), ['wss://relay.example/t3']);
});

test('a bare address is tried the way the page is first, then the other way', () => {
  assert.deepEqual(serverAddresses('192.168.1.16:8790', app), ['wss://192.168.1.16:8790', 'ws://192.168.1.16:8790'], "an app's server without a certificate reached the plain way");
  assert.deepEqual(serverAddresses('relay.example:443', plain), ['ws://relay.example:443', 'wss://relay.example:443'], 'a server with one reached from a plain page');
});

test('none typed: the server beside the page, none beside an app', () => {
  assert.deepEqual(serverAddresses('', plain), ['ws://192.168.1.16:5191/relay']);
  assert.deepEqual(serverAddresses('', secure), ['wss://pc.local:5190/relay']);
  assert.deepEqual(serverAddresses('', app), []);
  assert.deepEqual(serverAddresses('', desktop), []);
});
