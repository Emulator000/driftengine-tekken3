/**
 * A self-signed certificate for the home network's page (`npm run dev:lan`), made with nothing but
 * `node:crypto`: an ECDSA P-256 key, and an X.509 v3 certificate naming the machine's addresses and
 * names, for a server (extended key use `serverAuth`), valid for 825 days, the longest a phone
 * accepts. It is its own authority (basic constraints CA), so a device may also install it as a
 * trusted root.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isIP } from 'node:net';

/** The days a certificate lasts, from a day before it is made. */
export const CERTIFICATE_DAYS = 825;

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** A DER value: its tag, its length and its body. */
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...parts) => der(0x30, ...parts);
const set = (...parts) => der(0x31, ...parts);
const octets = (bytes) => der(0x04, bytes);
const bits = (bytes, unused = 0) => der(0x03, Buffer.from([unused]), bytes);
const utf8 = (text) => der(0x0c, Buffer.from(text, 'utf8'));
const TRUE = der(0x01, Buffer.from([0xff]));

function oid(dotted) {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const n of rest) {
    const groups = [];
    for (let v = n; ; v = Math.floor(v / 128)) {
      groups.unshift(v & 0x7f);
      if (v < 128) break;
    }
    bytes.push(...groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g)));
  }
  return der(0x06, Buffer.from(bytes));
}

/** UTCTime through 2049, GeneralizedTime from 2050. */
function time(date) {
  const stamp = `${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  return date.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(stamp.slice(2))) : der(0x18, Buffer.from(stamp));
}

/** An IPv4 or IPv6 address as its bytes. */
function addressBytes(address) {
  if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number));
  const [head, tail = ''] = address.split('::');
  const words = (part) => (part === '' ? [] : part.split(':').map((w) => parseInt(w, 16)));
  const front = words(head);
  const back = words(tail);
  const all = address.includes('::') ? [...front, ...new Array(8 - front.length - back.length).fill(0), ...back] : front;
  const out = Buffer.alloc(16);
  all.forEach((w, i) => out.writeUInt16BE(w, i * 2));
  return out;
}

const extension = (id, value, critical = false) => sequence(oid(id), ...(critical ? [TRUE] : []), octets(value));

/**
 * A key and a certificate, both PEM, for `names` (host names) and `addresses` (IP addresses), named
 * `common` and valid from a day before `now` for `CERTIFICATE_DAYS`.
 */
export function makeCertificate({ common, names, addresses, now = new Date() }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  /* The key's own bits, past the algorithm: what its identifier is the hash of. */
  const keyId = createHash('sha1').update(spki.subarray(-65)).digest();
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x40;
  const name = sequence(set(sequence(oid('2.5.4.3'), utf8(common))));
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const until = new Date(from.getTime() + CERTIFICATE_DAYS * 24 * 3600 * 1000);
  const alternatives = sequence(...names.map((n) => der(0x82, Buffer.from(n, 'ascii'))), ...addresses.map((a) => der(0x87, addressBytes(a))));
  const extensions = sequence(
    extension('2.5.29.19', sequence(TRUE), true),
    extension('2.5.29.15', bits(Buffer.from([0x84]), 2), true),
    extension('2.5.29.37', sequence(oid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.14', octets(keyId)),
    extension('2.5.29.35', sequence(der(0x80, keyId))),
    extension('2.5.29.17', alternatives),
  );
  const body = sequence(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), algorithm, name, sequence(time(from), time(until)), name, spki, der(0xa3, extensions));
  const certificate = sequence(body, algorithm, bits(sign('sha256', body, privateKey)));
  const lines = certificate.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`,
  };
}
