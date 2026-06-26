/**
 * Production entrypoint.
 *
 * TanStack Start's built `dist/server/server.js` handles SSR, but in the
 * Vite-based build it does not serve `dist/client/` static assets. This
 * wrapper does both: try a file out of `dist/client/` first, otherwise hand
 * the request to the SSR fetch handler. SSR responses are returned with
 * `Cache-Control: no-store` because every page in this app is live state.
 *
 * WebSocket connections to /ws are upgraded here for the lobby presence +
 * config-sync feature; the handler lives in ws-server.ts.
 */
import { resolve } from "node:path";
import { wsHandler, tryWsUpgrade } from "./ws-server";
// @ts-expect-error - emitted at build time, not present at typecheck time
import ssr from "./dist/server/server.js";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = resolve(import.meta.dir, "dist", "client");

Bun.serve({
  port: PORT,
  websocket: wsHandler,
  // @ts-expect-error - Bun passes `server` as second arg; TS types don't reflect it
  async fetch(req: Request, bunServer: Parameters<typeof tryWsUpgrade>[1]) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const res = tryWsUpgrade(req, bunServer);
      // undefined = upgrade succeeded, Bun owns the socket; return nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (res === undefined) return undefined as any;
      return res;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const candidate = resolve(CLIENT_DIR, "." + decodeURIComponent(url.pathname));
      if (candidate.startsWith(CLIENT_DIR + "/") || candidate === CLIENT_DIR) {
        const file = Bun.file(candidate);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
          });
        }
      }
    }

    const res = await ssr.fetch(req);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
});

console.log(`bigboom listening on :${PORT}`);
