# Bitaverse multiplayer on artificer

This is the Colyseus backend for `arief0303/bitaverse-developer-build`.
It preserves the schema-v2 protocol. City Plaza uses `my_room`; Landmark uses
`landmark_room`. Separate room types isolate presence, movement and avatars
between maps. A traveller leaves the old room before joining the destination.
Room state is in memory;
a container restart disconnects players and resets the room.

## Local development

Node.js 22 or later:

```sh
npm ci
npm test
npm run build
npm start
```

Defaults: `HOST=127.0.0.1`, `PORT=2567`. Health: `GET /health`.
There is deliberately no public `/colyseus` administrative monitor.

## artificer deployment

Working directory: `/home/ubuntu/services/bitaverse-multiplayer`.

```sh
sudo docker compose up -d --build
curl --fail http://127.0.0.1:2567/health
sudo tailscale funnel --bg --https=8443 http://127.0.0.1:2567
```

Public endpoint: `wss://artificer.taila649bb.ts.net:8443`.
Public health: `https://artificer.taila649bb.ts.net:8443/health`.
Only port 8443 is public through Funnel. Existing private Serve endpoints
on 443, 9119 and 20128 must remain unchanged. Do not use `funnel reset`.
No new public firewall rule is needed. Tailscale must remain running.

Compose binds the container only to host loopback, restarts it after failure
or reboot, and limits it to 384 MiB RAM and 0.5 CPU. It runs as a non-root
user with a read-only root filesystem, no extra capabilities, and bounded logs.
WebSocket messages and HTTP matchmaking POST bodies are limited to 4096 bytes.
Declared oversized bodies and streamed/chunked limit crossings return HTTP 413
and close the connection before matchmaking dispatch. The version-specific
`src/colyseus15.ts` adapter also removes inherited message-handler properties,
rejects noncanonical/unregistered message headers before the legacy decoder,
and validates MessagePack allocation limits before dispatch. Invalid packets
use a fixed, bounded WebSocket close reason and the existing protocol close code.
Invalid movement/text payloads are ignored instead of entering the shared schema.
This remains an anonymous public demo, not an authenticated or authoritative
anti-cheat game server; these per-message limits are not connection/rate limiting.

Verification: `npm test`; two browser clients must join `my_room`, see each
other, exchange position/animation/name updates and remove a departing player.
Health alone does not verify multiplayer.

## Dependency boundary

Colyseus server 0.15.57 and browser SDK 0.15.28 preserve the schema v2 protocol.
The old Arena/monitor/Mongoose dependency graph has been removed. The 0.15
core still depends on Nano ID 2 and npm audit reports its size-argument
advisories. Colyseus uses fixed internal ID sizes; the app does not expose a
caller-controlled ID length. This is not a claim of a vulnerability-free
stack. A future major protocol upgrade should update client and server together.

## Stop only Bitaverse

```sh
sudo tailscale funnel --https=8443 off
sudo docker compose down
```

Neither command should change Durandal's services.
