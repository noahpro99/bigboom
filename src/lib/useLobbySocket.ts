import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleType } from "./types";

const DEV_WS_PORT = 3001;

function wsUrl(roomId: string, sessionId: string): string {
  const params = new URLSearchParams({ room: roomId, session: sessionId });
  if (import.meta.env.DEV) {
    return `ws://localhost:${DEV_WS_PORT}/ws?${params}`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws?${params}`;
}

export interface LobbyPlayer {
  role: string;
  isMe: boolean;
}

export interface LobbyConfig {
  seed: number;
  timerSeconds: number;
  moduleTypes: ModuleType[];
}

export interface LobbyStart {
  gameId: string;
  startedAt: number;
}

export function useLobbySocket({
  roomId,
  sessionId,
  role,
  onPlayers,
  onConfig,
  onStart,
}: {
  roomId: string;
  sessionId: string;
  role: string;
  onPlayers: (p: LobbyPlayer[]) => void;
  onConfig: (c: LobbyConfig) => void;
  onStart?: (s: LobbyStart) => void;
}) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const roleRef = useRef(role);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks fresh without triggering reconnect.
  const onPlayersRef = useRef(onPlayers);
  const onConfigRef = useRef(onConfig);
  const onStartRef = useRef(onStart);
  useEffect(() => { onPlayersRef.current = onPlayers; }, [onPlayers]);
  useEffect(() => { onConfigRef.current = onConfig; }, [onConfig]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);

  useEffect(() => {
    if (!roomId || !sessionId || typeof window === "undefined") return;
    let cancelled = false;
    let backoff = 1500;

    function connect() {
      if (cancelled) return;
      try {
        const ws = new WebSocket(wsUrl(roomId, sessionId));
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) { ws.close(); return; }
          setConnected(true);
          backoff = 1500;
          // Announce current role on every (re)connect — the URL param may be
          // stale if the user changed role while the socket was reconnecting.
          ws.send(JSON.stringify({ type: "role", role: roleRef.current }));
        };

        ws.onmessage = (e: MessageEvent<string>) => {
          try {
            const msg = JSON.parse(e.data) as { type: string } & Record<string, unknown>;
            if (msg.type === "players") onPlayersRef.current(msg.players as LobbyPlayer[]);
            if (msg.type === "config") onConfigRef.current(msg as unknown as LobbyConfig);
            if (msg.type === "start") {
              onStartRef.current?.({
                gameId: String(msg.gameId ?? ""),
                startedAt: Number(msg.startedAt ?? 0),
              });
            }
          } catch {}
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!cancelled) {
            setConnected(false);
            onPlayersRef.current([]); // clear stale list immediately on disconnect
            timerRef.current = setTimeout(() => {
              backoff = Math.min(backoff * 1.5, 12000);
              connect();
            }, backoff);
          }
        };

        ws.onerror = () => ws.close();
      } catch {
        // WebSocket constructor throws if URL is invalid or WS is unavailable.
        setConnected(false);
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, sessionId]);

  // Notify server when role changes.
  useEffect(() => {
    roleRef.current = role;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "role", role }));
    }
  }, [role]);

  const sendConfig = useCallback((config: LobbyConfig) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "config", ...config }));
    }
  }, []);

  const sendStart = useCallback((s: LobbyStart) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "start", ...s }));
    }
  }, []);

  return { connected, sendConfig, sendStart };
}
