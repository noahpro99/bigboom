# BigBoom

Two-player co-op bomb defusal in a browser. One player sees the bomb, the other reads a manual with the rules. They talk. The bomb explodes if they're wrong. Inspired by *Keep Talking and Nobody Explodes*.

Live at [bigboom.gwendo.land](https://bigboom.gwendo.land).

## How to play

1. Host arms a bomb, gets a room code and QR.
2. Second player joins via QR, paste code, or shared URL.
3. Roles: **Defuser** (sees the bomb), **Expert** (sees the manual), **Spectator** (sees the bomb, can't touch it).
4. Timer runs. Three strikes and it detonates. Solve every module before the clock hits zero.

Modules currently in the bomb: simple wires, big button, symbol keypad, Simon says, memory, morse code, maze, password, complicated wires (Venn diagram rules), Who's on First, wire sequences.

## Offline-first

Everything gameplay-critical runs locally in the browser. No round-trip per click.

Both peers derive the bomb from a shared **seed** (`src/lib/generator.ts`, pure + seedable via `mulberry32`). Same seed → identical bomb → identical manual → identical solution. Neither peer needs to ask a server whether a cut was correct; each one runs the same validator and agrees.

The seed and module counts get packed into a short share code (`bb1.<seed>.<timer>.<counts>` — `src/lib/offlineCode.ts`) and encoded into the QR / invite URL. Joining via that URL is the whole sync mechanism.

State survives page reloads via `localStorage["bigboom-offline"]`. A service worker (`/sw.js`) precaches the shell so the app opens cold with no network.

## Online (optional)

The server is not the source of truth — it's for analytics and pre-arm presence.

- `src/lib/sync.ts` fires `trackLobby` / `trackResult` when a bomb is armed and when it ends. Errors are swallowed.
- `src/lib/useLobbySocket.ts` opens a WebSocket to `/ws` for "who's in the lobby right now" before the bomb is armed. Auto-reconnects, non-blocking. Once the bomb is armed, the WebSocket doesn't do anything gameplay-critical.

## Stack

- **TanStack Start** (React 19, SSR, file-based routes, server functions)
- **Bun** runtime — `bun dev`, `bun run build`, `bun start`
- **Vite** + **Tailwind v4**
- **bun:sqlite** for the analytics DB (lobby snapshots, results)
- Deployed as a single-container Docker image behind Traefik

## Layout

```
src/
├── routes/
│   ├── index.tsx          # home, join screen
│   ├── lobby.tsx          # host, join, configure, PLAY, restore — the whole game lives here
│   └── game.$gameId.tsx   # legacy server-driven route (kept for compatibility)
├── lib/
│   ├── generator.ts       # deterministic bomb + manual + solution from a seed
│   ├── offlineEngine.ts   # applyCutWire, applyTapButton, etc. — local move validators
│   ├── offlineCode.ts     # share code encode/decode
│   ├── sync.ts            # fire-and-forget analytics to server
│   ├── useLobbySocket.ts  # pre-arm presence over WebSocket
│   ├── types.ts           # single source of truth for module configs
│   └── session.ts         # per-tab UUID
├── components/
│   ├── bomb/              # one component per module + the WireBody / Timer / BatteryPanel
│   ├── manual/            # ManualView + per-module rule pages
│   └── offline/           # QrCode, QrScanner
├── server/
│   └── game.ts            # analytics server functions + legacy per-move handlers
└── styles/app.css         # bomb chassis + wire animations

serve.ts                   # Bun.serve — static + SSR + /ws upgrade
ws-server.ts               # lobby presence WebSocket handler
Dockerfile                 # multi-stage bun build for deploy
```

## Commands

```
bun install
bun dev         # Vite dev server with HMR
bun run build   # dist/{client,server}
bun start       # run built app via serve.ts
bun run typecheck
```

`PORT` (default 3000) and `DB_PATH` (default `./bigboom.db`) are the only env vars.

## Adding a module

1. Add the module type to `src/lib/types.ts` (config shape, state shape, `ModuleType` union, any legend maps).
2. Add a generator to `src/lib/generator.ts` that takes a seed and returns the config. Add a manual page for the same seed. Add a `getXSolution` used by the validator.
3. Add an `applyXMove` to `src/lib/offlineEngine.ts` that consumes a move and returns the next `GameState`. This is what runs locally on both peers.
4. Add a UI component under `src/components/bomb/` for the module and a matching manual page block under `src/components/manual/`.
5. Wire it up in `BombView.tsx` (render dispatch) and `ManualView.tsx` (page dispatch).

Both peers must agree, so anything in generation or validation has to be engine-independent — use `shuffleArray(rng, arr)` instead of `arr.sort(() => rng() - 0.5)`.
