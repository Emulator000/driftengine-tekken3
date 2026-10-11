/** The home network's certificate (`npm run dev:lan`): what it names, how long it lasts, and that a TLS server takes it. */
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { test } from 'node:test';

import { CERTIFICATE_DAYS, makeCertificate } from '../scripts/lib/certificate.mjs';

const NOW = new Date('2026-10-11T12:00:00Z');
const made = makeCertificate({ common: 'test', names: ['localhost', 'machine.home'], addresses: ['127.0.0.1', '192.168.1.20', 'fd00::1:2'], now: NOW });
const cert = new X509Certificate(made.cert);

test('the certificate names its hosts and addresses', () => {
  assert.equal(cert.checkHost('localhost'), 'localhost');
  assert.equal(cert.checkHost('machine.home'), 'machine.home');
  assert.equal(cert.checkHost('elsewhere.home'), undefined);
  assert.equal(cert.checkIP('192.168.1.20'), '192.168.1.20');
  assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
  assert.equal(cert.checkIP('fd00:0:0:0:0:0:1:2'), 'fd00:0:0:0:0:0:1:2');
  assert.equal(cert.checkIP('192.168.1.21'), undefined);
});

test('the certificate serves TLS for its key, is its own authority, and lasts no more than a phone accepts', () => {
  assert.ok(cert.verify(createPublicKey(createPrivateKey(made.key))));
  assert.ok(cert.checkIssued(cert));
  assert.ok(cert.ca);
  assert.deepEqual(cert.keyUsage, ['1.3.6.1.5.5.7.3.1']);
  const from = Date.parse(cert.validFrom);
  const until = Date.parse(cert.validTo);
  assert.ok(from < NOW.getTime() && NOW.getTime() < until);
  assert.equal((until - from) / (24 * 3600 * 1000), CERTIFICATE_DAYS);
  assert.ok(CERTIFICATE_DAYS <= 825);
});

test('a TLS server starts with it', async () => {
  const server = createServer({ key: made.key, cert: made.cert });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => server.close(resolve));
});
