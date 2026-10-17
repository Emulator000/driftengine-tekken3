import { X509Certificate } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Plugin, defineConfig } from 'vite';

import { makeCertificate } from './scripts/lib/certificate.mjs';
import { Relay, readConfig } from './server/relay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The engine comes from npm, unless a checkout sits at `../drftrun/driftengine`.
 *
 * With the checkout there, every engine import resolves to its source, so an engine edit is live
 * here on save. `DRIFT_ENGINE_LOCAL=0` forces the installed packages, which is what to reach for
 * when a bug might be the checkout's fault.
 */
const ENGINE_SRC = path.join(here, '../drftrun/driftengine/packages');
const LOCAL_ENGINE =
  process.env.DRIFT_ENGINE_LOCAL !== '0' && existsSync(path.join(ENGINE_SRC, 'core/src/index.ts'));

/** What this player imports (`network` for its online matches), and what core's own barrel imports: `physics` and `drft`. */
const ENGINE_PACKAGES = ['core', 'physics', 'drft', 'audio', 'ui2d', 'network'].join('|');

/** The days before a certificate ends that a new one is made. */
const RENEW_DAYS = 30;
/** The most a page's log post may hold. */
const LOG_POST_BYTES = 1 << 20;

/**
 * The home network's certificate (`.cache/lan/`): made the first time, and again when it is near
 * its end or no longer names every address the machine has on the network (a router gave it a new
 * one), which the phone then asks to accept once more.
 */
function lanCertificate(): { key: Buffer; cert: Buffer } {
  const dir = path.join(here, '.cache/lan');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const addresses = lanAddresses();
  if (existsSync(keyFile) && existsSync(certFile)) {
    const cert = new X509Certificate(readFileSync(certFile));
    const ends = Date.parse(cert.validTo) - RENEW_DAYS * 24 * 3600 * 1000;
    if (Date.now() < ends && addresses.every((a) => cert.checkIP(a) !== undefined)) return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  }
  const { key, cert } = makeCertificate({ common: 'Tekken 3 on DriftEngine, home network', names: ['localhost', hostname()], addresses });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, key);
  writeFileSync(certFile, cert);
  return { key: Buffer.from(key), cert: Buffer.from(cert) };
}

/** The machine's IPv4 addresses, on the home network and its own. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4')
    .map((a) => a!.address);
}

/**
 * The same page over plain HTTP too, on the home network, at the port after the HTTPS one's (or the
 * next free past it), for a device that is not to be asked for the certificate. Its WebSockets (the
 * online server at `/relay`, the page's reloads) go where the HTTPS server's go, so its players meet
 * those on HTTPS. A page over HTTP from another address is no secure page, which a browser keeps
 * WebGPU and full screen for (and some the gamepads). `T3_LAN_HTTP=0` leaves it out.
 */
function plainHttp(): Plugin {
  return {
    name: 'tekken3-lan-http',
    apply: 'serve',
    configureServer(server) {
      const secure = server.httpServer;
      if (process.env.T3_LAN_HTTP === '0' || secure === null) return;
      const plain = createServer(server.middlewares);
      plain.on('upgrade', (request, socket, head) => secure.emit('upgrade', request, socket, head));
      const listen = (port: number, tries: number): void => {
        plain.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE' && 0 < tries) listen(port + 1, tries - 1);
          else server.config.logger.warn(`  HTTP: ${error.message}`);
        });
        plain.listen(port, () => server.config.logger.info(lanAddresses().map((address) => `  ➜  HTTP:    http://${address}:${port}/`).join('\n')));
      };
      secure.once('listening', () => {
        const at = secure.address();
        listen((typeof at === 'object' && at !== null ? at.port : 5190) + 1, 10);
      });
      secure.once('close', () => plain.close());
    },
  };
}

/**
 * What a page on another device logs (`src/app/remote-log.ts`), posted to `/__log` and kept in
 * `.cache/client.log` under the address it came from, so a phone's tab that stalls or crashes leaves
 * its last moments on the machine serving it.
 */
function clientLog(): Plugin {
  return {
    name: 'tekken3-client-log',
    apply: 'serve',
    configureServer(server) {
      const file = path.join(here, '.cache/client.log');
      server.middlewares.use('/__log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= LOG_POST_BYTES) chunks.push(chunk);
        });
        req.on('end', () => {
          const from = req.socket.remoteAddress ?? '?';
          const text = Buffer.concat(chunks).toString('utf8');
          mkdirSync(path.dirname(file), { recursive: true });
          appendFileSync(file, text.split('\n').map((line) => `${new Date().toISOString()} ${from} ${line}\n`).join(''));
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

/**
 * ONLINE MODE's server (`server/relay.mjs`) beside the page, at `/relay` on the dev server's own
 * address (over HTTPS on the home network, as the page is), which the page connects to when no
 * other is set: two players on the same network, or on one machine, play with nothing else run.
 * Its settings are the environment's (`T3_RELAY_*`); `T3_RELAY=0` leaves it out.
 */
function onlineServer(): Plugin {
  return {
    name: 'tekken3-online-server',
    apply: 'serve',
    configureServer(server) {
      const http = server.httpServer;
      if (process.env.T3_RELAY === '0' || http === null) return;
      const relay = new Relay(readConfig([], process.env), { log: (line) => server.config.logger.info(line) });
      relay.attach(http as Parameters<Relay['attach']>[0], '/relay');
      /* Its page and numbers at /relay itself, for a browser opened there. */
      server.middlewares.use('/relay', (request, response) => relay.http(request, response));
      http.once('close', () => void relay.close());
    },
  };
}

/**
 * `npm run dev:lan` (`vite --mode lan`): the page served to the user's own devices on their home
 * network, over HTTPS with the certificate above, so a phone or a tablet gets WebGPU and full
 * screen, which a page over plain HTTP from another address is refused; and over plain HTTP too at
 * the next port (`plainHttp`). Pages there post their log back (`clientLog`).
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: LOCAL_ENGINE
      ? [
          {
            find: new RegExp(`^@driftengine/(${ENGINE_PACKAGES})/(.*)$`),
            replacement: path.join(ENGINE_SRC, '$1/src/$2'),
          },
          {
            find: new RegExp(`^@driftengine/(${ENGINE_PACKAGES})$`),
            replacement: path.join(ENGINE_SRC, '$1/src/index.ts'),
          },
        ]
      : [],
  },
  plugins: mode === 'lan' ? [clientLog(), onlineServer(), plainHttp()] : [onlineServer()],
  /*
   * 5190 when it is free, otherwise the next port that is: Vite prints the one it took. Served to
   * this machine alone, the page loading the disc's data; `npm run dev:lan` alone serves the home
   * network.
   */
  server: mode === 'lan' ? { host: true, port: 5190, https: lanCertificate() } : { host: 'localhost', port: 5190 },
  preview: { host: 'localhost' },
  build: { target: 'es2022' },
}));
