# The online server

ONLINE MODE's players meet through this server. It pairs two players (a quick match, a room by its
code, the room list) and passes their messages between them: the pads' words, the match's setup and
the direct connection's signalling. It holds none of the game's data, and runs no game: each player
plays from their own disc on their own machine, and once the two reach each other directly (WebRTC)
the pads' words go straight between them.

## On this machine

`npm run dev` and `npm run dev:lan` already run it beside the page, at `/relay` on the dev server's
own address, and the page connects there when no other server is set. Two players on the same home
network play with nothing else to run (`npm run dev:lan`, both opening the address it prints).
`T3_RELAY=0` leaves it out.

## On a server of its own

The folder runs alone: Node 20 or later and its one package.

```sh
cd server
npm install
node relay.mjs --port 8790
```

or from the repository, `npm run relay -- --port 8790`, or in a container:

```sh
docker build -t tekken3-relay server
docker run -d --restart unless-stopped -p 8790:8790 tekken3-relay
```

Players then set **SERVER** on ONLINE MODE's page to its address (`relay.example:8790`,
`wss://relay.example/`), or open the page with `?server=wss://relay.example/`.

`GET /health` answers `ok clients=N rooms=N queued=N`. Its log names each player by name and
address as they connect, are offered, paired and leave (behind a proxy, the address the proxy
passes in `X-Forwarded-For`); Ctrl+C stops it at once.

## Settings

Each is read from a JSON file (`--config file.json`, or `T3_RELAY_CONFIG`), then the environment,
then the command line, each over the one before. `node relay.mjs --help` lists them.

| Setting | Environment | Default | |
|---|---|---|---|
| `--host` | `T3_RELAY_HOST` | `0.0.0.0` | the address to listen on |
| `--port` | `T3_RELAY_PORT` | `8790` | the port |
| `--path` | `T3_RELAY_PATH` | `/` | the WebSocket's path |
| `--name` | `T3_RELAY_NAME` | `TEKKEN 3 SERVER` | the name players are shown |
| `--motd` | `T3_RELAY_MOTD` | | a line players are shown on connecting |
| `--cert`, `--key` | `T3_RELAY_CERT`, `T3_RELAY_KEY` | | a TLS certificate and its key (PEM): the server speaks `wss` |
| `--origins` | `T3_RELAY_ORIGINS` | any | the page origins allowed to connect, comma separated |
| `--ice` | `T3_RELAY_ICE` | Google's public STUN | the ICE servers players are told, as `RTCIceServer` JSON (a TURN server of your own goes here; `[]` keeps every match on this server) |
| `--max-clients` | `T3_RELAY_MAX_CLIENTS` | `500` | the most players at once |
| `--max-rooms` | `T3_RELAY_MAX_ROOMS` | `200` | the most rooms at once |
| `--listed` | `T3_RELAY_LISTED` | `50` | the most rooms the room list shows |
| `--offer` | `T3_RELAY_OFFER` | `10` | seconds two players the quick match brings together have to say yes |
| `--idle` | `T3_RELAY_IDLE` | `300` | seconds a player may say nothing before being let go |
| `--rate` | `T3_RELAY_RATE` | `400` | the most messages a second a player may send |
| `--max-message` | `T3_RELAY_MAX_MESSAGE` | `16384` | a message's most bytes |

A config file names them as above, by their name in camel case:

```json
{ "port": 8790, "name": "MY SERVER", "origins": ["https://my.page.example"], "ice": [{ "urls": "stun:stun.l.google.com:19302" }] }
```

## Secure pages

A page served over HTTPS (`npm run dev:lan`, any public page) connects only to a `wss:` server:
give the server a certificate (`--cert`, `--key`), or put it behind a proxy that has one. Caddy:

```
relay.example {
    reverse_proxy 127.0.0.1:8790
}
```

nginx needs the upgrade passed on:

```
location / {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## As a service

```ini
[Unit]
Description=Tekken 3 online server
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/tekken3-relay/relay.mjs --host 127.0.0.1 --port 8790
Restart=always
User=tekken3

[Install]
WantedBy=multi-user.target
```
