# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use `bun` for everything — never `npm`/`npx`/`node`.

- `bun install` — install deps
- `bun dev` — Vite dev server with HMR
- `bun run build` — production build into `dist/{client,server}/`
- `bun start` — run the built app via `serve.ts` (requires `bun run build` first)
- `bun run typecheck` — `tsc --noEmit`

No test runner is configured.

The SQLite file path defaults to `./bigboom.db` and can be overridden with `DB_PATH`. The server port is `PORT` (default 3000).

## Architecture

BigBoom is a two-player co-op bomb defusal game (Keep Talking and Nobody Explodes-style). One player is the **Defuser** (sees the bomb), the other is the **Expert** (sees the manual). They share a room code and play in separate browser tabs/devices.

### Stack

- **TanStack Start** (React 19, SSR + file-based routing + server functions)
- **Vite** build, **Tailwind v4** styling
- **Bun runtime** + `bun:sqlite` for persistence
- **TanStack Query** for client data fetching (polling, not websockets)

### Request flow in production

`serve.ts` is the prod entrypoint. It tries to serve a file from `dist/client/` first (with `immutable` caching for hashed assets), and falls back to the SSR fetch handler from `dist/server/server.js` with `Cache-Control: no-store` (every page is live game state). `bun dev` bypasses this wrapper — Vite serves both directly.

### Server functions are the API

There is no separate REST/RPC layer. All client→server calls go through TanStack Start server functions defined in `src/server/game.ts` and invoked from React via `useQuery`/`useMutation`. The exported functions (`createGame`, `joinGame`, `getGameState`, `startGame`, `cutWire`, `tapButton`, `startHold`, `releaseHold`, `pressSymbol`, `checkTimer`, `switchRole`, `restartGame`) are the full server surface — every puzzle action is re-validated server-side against the module config.

### Realtime via polling

There are no websockets. `getGameState` is polled every ~1500 ms by the game route (`src/routes/game.$gameId.tsx`). The same call doubles as a presence heartbeat — it updates `game_players.last_seen` for the calling session, and `ACTIVE_SECONDS` (10s) in `src/server/game.ts` defines who counts as "in the room."

### Session identity

`src/lib/session.ts` mints a per-tab UUID in `sessionStorage` under key `bigboom-session`. This is the **session ID** sent with every server call — it's how the server distinguishes Defuser vs Expert on the same machine. Two tabs in one browser are two distinct players. SSR returns the sentinel `"ssr"`, so any code that needs the real session ID must run client-side (typical pattern: `useState("")` + `useEffect` to set it).

### Deterministic puzzle generation

`src/lib/generator.ts` is pure and seedable (`mulberry32`). A bomb's `seed` (stored on `games.seed`) plus its `serial_number` fully determine:

- every wire/button/symbols module config
- the manual the Expert sees (`generateManualPages`)
- the correct solution (`getWireSolution`, `getButtonAction`, `getSymbolsSolution`)

The server validates moves by regenerating the solution from the seed — the client cannot lie. Symbol modules on the same bomb share one set of columns (one manual page covers all symbol modules) but get distinct `activeSymbols`.

### Database schema

Defined inline in `src/lib/db.ts` (executed via `CREATE TABLE IF NOT EXISTS` on first connection — there are no migrations). Tables:

- `games` — id (6-char room code), seed, serial, status, timer, strikes
- `game_players` — (game_id, session_id) → role + last_seen heartbeat
- `modules` — per-bomb puzzle instances with `config_json` (immutable, from seed) and `state_json` (mutable, e.g. cut wires, pressed symbols)
- `exchanges` — reserved for future chat/log; not currently written

WAL mode is enabled. The DB connection is a process-wide singleton.

### Type system

`src/lib/types.ts` is the contract between generator, server validators, manual renderer, and UI. The `WireCondition` discriminated union is recursive (and/or/xor/nand/nor/not over atomic facts about the bomb) and is evaluated both when generating the manual text and when validating cuts — keep those in sync if you add a new condition variant.

### Path alias

`~` resolves to `/src` (set in `vite.config.ts`). Note: `tsconfig.json`'s `paths` entry points at `./app/*` and is stale — Vite's alias is what actually runs. Prefer relative imports or fix the tsconfig if it gets in your way.
