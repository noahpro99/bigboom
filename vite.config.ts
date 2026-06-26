import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

/* Starts a standalone Bun WebSocket server on WS_PORT (default 3001) so the
   lobby presence + config-sync feature works during `bun dev`. The client
   connects to ws://localhost:3001 in dev and the same host/port as the app
   in production (ws handled in serve.ts). */
function devLobbyWsPlugin() {
  return {
    name: "bigboom-lobby-ws-dev",
    configureServer() {
      const WS_PORT = Number(process.env.WS_PORT ?? 3001);
      import("./ws-server.ts")
        .then(({ wsHandler, tryWsUpgrade }) => {
          Bun.serve({
            port: WS_PORT,
            websocket: wsHandler,
            fetch(req: Request, srv: Parameters<typeof tryWsUpgrade>[1]) {
              const url = new URL(req.url);
              if (url.pathname === "/ws") {
                const res = tryWsUpgrade(req, srv);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (res === undefined) return undefined as any;
                return res;
              }
              return new Response("Not found", { status: 404 });
            },
          });
          console.log(`  ↳ lobby WS dev server on :${WS_PORT}`);
        })
        .catch((e: unknown) => {
          console.error("Failed to start lobby WS dev server:", e);
        });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
    devLobbyWsPlugin(),
  ],
  resolve: {
    alias: {
      "~": "/src",
    },
  },
});
