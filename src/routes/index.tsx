import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { play, preloadAll, playMusic } from "../lib/sound";
import { decodeMatch, encodeMatch } from "../lib/offlineCode";
import { ProfileButton } from "../components/ProfileButton";
import { QrScanner } from "../components/offline/QrScanner";
import { Bomb, ArrowRight, Link2, AlertTriangle, ScanLine } from "lucide-react";
import { DiscordIcon } from "../components/icons/Discord";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const DISCORD_URL = "https://discord.gg/bigboom";

function parseInviteLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, "http://placeholder.local");
    const match = url.pathname.match(/\/game\/([A-Z0-9]{6})/i);
    if (match) return match[1].toUpperCase();
  } catch {
    /* fall through */
  }
  const bare = trimmed.match(/([A-Z0-9]{6})/i);
  return bare ? bare[1].toUpperCase() : null;
}

function HomePage() {
  const navigate = useNavigate();
  const [pasteInput, setPasteInput] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  // First user interaction unlocks audio on Safari/Chrome — preload SFX and
  // kick off the menu music then. Browsers won't autoplay before a gesture.
  useEffect(() => {
    const once = () => {
      preloadAll();
      playMusic("menuMusic");
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  async function handleCreate() {
    play("menuButton");
    await navigate({ to: "/lobby" });
  }

  async function joinFromText(text: string) {
    // A match code (or a /lobby?join= link) opens the lobby on that bomb.
    const decoded = decodeMatch(text.trim());
    if (decoded) {
      setPasteError("");
      play("menuButton");
      // Forward the room= param so the guest lands in the host's WS room.
      let room: string | undefined;
      try {
        const url = new URL(text.trim(), window.location.href);
        room = url.searchParams.get("room") ?? undefined;
      } catch {}
      // Pass the clean encoded code, not the full URL string.
      await navigate({ to: "/lobby", search: { join: encodeMatch(decoded), ...(room ? { room } : {}) } });
      return;
    }
    // Back-compat: a bare 6-char room code still opens the legacy room.
    const gameId = parseInviteLink(text);
    if (!gameId) {
      setPasteError("Couldn't read a game from that link");
      return;
    }
    setPasteError("");
    play("menuButton");
    await navigate({
      to: "/game/$gameId",
      params: { gameId },
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    play("menuButton");
    setPasteInput(pasted);
    joinFromText(pasted);
  }

  return (
    <div className="min-h-screen tx-grid relative overflow-hidden">
      {/* Corner stripes */}
      <div className="absolute top-0 left-0 w-32 h-6 tx-stripes opacity-80" />
      <div className="absolute bottom-0 right-0 w-32 h-6 tx-stripes opacity-80" />

      {/* Faint radial vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(5, 10, 20, 0.95) 80%)",
        }}
      />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top status bar */}
        <header className="border-b border-rib/60 px-6 py-3 flex items-center justify-between text-xs font-mono uppercase tracking-[0.18em] text-bone-dim">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-phosphor pulse-dot" />
            <span>Defusal Protocol · ONLINE</span>
          </div>
          <div className="flex items-center gap-3 opacity-70">
            <span className="hidden sm:inline">RIA-2074</span>
            <span className="hidden sm:inline opacity-50">//</span>
            <span className="hidden sm:inline">Site 11 // Containment</span>
            <ProfileButton variant="dark" />
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-10">
          {/* Hero */}
          <div className="text-center mb-12 reveal" style={{ animationDelay: "60ms" }}>
            <div className="inline-flex items-center gap-2 mb-5 text-amber border border-amber/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em]">
              <AlertTriangle size={12} strokeWidth={2.5} />
              <span>HANDLE WITH CARE</span>
            </div>

            <h1 className="font-stencil leading-[0.85] tracking-tight">
              <span className="block text-6xl sm:text-7xl md:text-8xl text-bone">BIG</span>
              <span className="block text-6xl sm:text-7xl md:text-8xl text-crimson">BOOM</span>
            </h1>

            <div className="flex items-center gap-3 justify-center mt-4">
              <div className="h-px w-12 bg-bone-dim/40" />
              <p className="text-bone-dim font-mono text-[11px] uppercase tracking-[0.3em]">
                Cooperative · Two-player · Voice-required
              </p>
              <div className="h-px w-12 bg-bone-dim/40" />
            </div>
          </div>

          {/* Actions */}
          <div className="w-full max-w-md flex flex-col gap-3 reveal" style={{ animationDelay: "180ms" }}>
            {/* Enter the lobby — build/share a bomb and play. Runs offline
                instantly; tracks online when it can. */}
            <button
              onClick={handleCreate}
              className="group relative overflow-hidden bg-amber text-void hover:bg-amber-glow transition-colors font-stencil text-2xl tracking-wider uppercase px-6 py-5 flex items-center justify-between"
            >
              <span className="flex items-center gap-3">
                <Bomb size={28} strokeWidth={2.5} />
                <span>Arm a Bomb</span>
              </span>
              <ArrowRight
                size={22}
                strokeWidth={2.5}
                className="transition-transform group-hover:translate-x-1"
              />
              {/* Bottom danger stripe */}
              <div className="absolute bottom-0 left-0 right-0 h-1 tx-stripes" />
            </button>

            {/* Scan QR */}
            <button
              onClick={() => { play("menuButton"); setScanOpen((v) => !v); }}
              aria-pressed={scanOpen}
              className={`px-5 py-3.5 border font-stencil text-xl uppercase tracking-[0.18em] flex items-center justify-center gap-3 transition-colors ${
                scanOpen
                  ? "border-cyan-rad bg-cyan-rad/14 text-cyan-rad"
                  : "border-cyan-rad/50 hover:border-cyan-rad bg-cyan-rad/8 hover:bg-cyan-rad/12 text-cyan-rad"
              }`}
            >
              <ScanLine size={22} strokeWidth={2.5} />
              <span>Scan QR Code</span>
            </button>

            {scanOpen && (
              <QrScanner
                onClose={() => setScanOpen(false)}
                onResult={(value) => {
                  setScanOpen(false);
                  setPasteInput(value);
                  joinFromText(value);
                }}
              />
            )}

            {/* Paste link */}
            <div className="mt-2 border border-rib bg-chassis/60 backdrop-blur-sm">
              <div className="border-b border-rib px-4 py-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                <Link2 size={12} strokeWidth={2.5} />
                <span>Incoming Transmission</span>
              </div>
              <div className="p-4">
                <input
                  value={pasteInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPasteInput(v);
                    setPasteError("");
                    // Auto-join when a full URL or code is typed/pasted via onChange
                    // (covers right-click paste, autofill, and drag-drop).
                    if (decodeMatch(v.trim())) joinFromText(v.trim());
                  }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pasteInput.trim()) joinFromText(pasteInput.trim());
                  }}
                  onFocus={() => play("menuButton")}
                  placeholder="Paste invite link or offline code"
                  className="w-full bg-void/60 border border-rib focus:border-amber/60 rounded-none px-3 py-2.5 text-bone font-mono text-sm placeholder:text-steel-light focus:outline-none transition-colors"
                />
                {pasteError && (
                  <p className="text-crimson text-xs font-mono mt-2 flex items-center gap-1.5">
                    <AlertTriangle size={11} />
                    {pasteError}
                  </p>
                )}
                <p className="text-bone-dim/60 text-[10px] font-mono uppercase tracking-widest mt-2">
                  Auto-joins as Expert · Switch role in lobby
                </p>
              </div>
            </div>

            {/* Discord — lower priority */}
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#5865F2] hover:bg-[#4752c4] text-bone transition-colors font-pmono text-sm font-semibold uppercase tracking-[0.2em] px-5 py-3.5 flex items-center justify-center gap-3"
            >
              <DiscordIcon size={20} />
              <span>Find Players on Discord</span>
            </a>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-rib/60 px-6 py-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim/70">
          <span>Each bomb procedurally generated</span>
          <span>v0.1 · Field Build</span>
        </footer>
      </div>
    </div>
  );
}
