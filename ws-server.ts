/* Lobby WebSocket server — shared by serve.ts (prod) and the Vite dev plugin.
   Never bundled into the browser; always runs in Bun. */
import type { ServerWebSocket } from "bun";

interface WsData {
  roomId: string;
  sessionId: string;
}

type Ws = ServerWebSocket<WsData>;

interface RoomState {
  players: Map<string, Ws>;
  // Roles are stored here, not in ws.data, because ws.data mutation is
  // unreliable (Bun may return a new object on each property access).
  roles: Map<string, string>;
  config: { seed: unknown; timerSeconds: unknown; moduleTypes: unknown } | null;
}

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { players: new Map(), roles: new Map(), config: null });
  }
  return rooms.get(roomId)!;
}

function broadcastPlayers(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  const snapshot = [...room.players.keys()].map((sid) => ({
    sid,
    role: room.roles.get(sid) ?? "spectator",
  }));
  for (const [sessionId, ws] of room.players.entries()) {
    const players = snapshot.map((p) => ({ role: p.role, isMe: p.sid === sessionId }));
    try { ws.send(JSON.stringify({ type: "players", players })); } catch {}
  }
}

export const wsHandler = {
  open(ws: Ws) {
    const { roomId, sessionId } = ws.data;
    const room = getOrCreateRoom(roomId);
    room.players.set(sessionId, ws);
    // Role will be set by the first "role" message sent in onopen; default to
    // spectator until then so broadcastPlayers has something to show.
    if (!room.roles.has(sessionId)) room.roles.set(sessionId, "spectator");
    broadcastPlayers(roomId);
    if (room.config) {
      try { ws.send(JSON.stringify({ type: "config", ...room.config })); } catch {}
    }
  },

  message(ws: Ws, raw: string | Buffer) {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as Record<string, unknown>;
      const { roomId, sessionId } = ws.data;

      if (msg.type === "role" && typeof msg.role === "string") {
        const room = rooms.get(roomId);
        if (!room) return;
        room.roles.set(sessionId, msg.role);
        broadcastPlayers(roomId);
        return;
      }

      if (msg.type === "config") {
        const room = rooms.get(roomId);
        if (!room) return;
        const cfg = {
          seed: msg.seed,
          timerSeconds: msg.timerSeconds,
          moduleTypes: msg.moduleTypes,
        };
        room.config = cfg;
        const out = JSON.stringify({ type: "config", ...cfg });
        for (const [sid, w] of room.players.entries()) {
          if (sid !== sessionId) try { w.send(out); } catch {}
        }
        return;
      }

      // Host clicked "Arm & Play". Relay the shared { gameId, startedAt }
      // to everyone else in the room so their lobbies enter play at the
      // same anchor time (timers agree).
      if (msg.type === "start") {
        const room = rooms.get(roomId);
        if (!room) return;
        const out = JSON.stringify({
          type: "start",
          gameId: msg.gameId,
          startedAt: msg.startedAt,
        });
        for (const [sid, w] of room.players.entries()) {
          if (sid !== sessionId) try { w.send(out); } catch {}
        }
      }
    } catch {}
  },

  close(ws: Ws) {
    const { roomId, sessionId } = ws.data;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(sessionId);
    room.roles.delete(sessionId);
    if (room.players.size === 0) rooms.delete(roomId);
    else broadcastPlayers(roomId);
  },
};

export function tryWsUpgrade(
  req: Request,
  server: { upgrade(req: Request, opts: { data: WsData }): boolean }
): Response | undefined {
  const url = new URL(req.url);
  const roomId = url.searchParams.get("room") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!roomId || !sessionId) return new Response("Missing room/session", { status: 400 });
  if (server.upgrade(req, { data: { roomId, sessionId } })) return undefined;
  return new Response("WebSocket upgrade failed", { status: 500 });
}
