import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { getCurrentUser } from "../server/auth";
import { getSessionId } from "../lib/session";
import { play } from "../lib/sound";

/* Modal-launcher button + the modal itself. Each page that wants Settings
   access just drops one of these in its existing header — no floating
   absolute positioning, no overlap with content. */

export type ProfileButtonVariant =
  | "dark" // on the bomb/lobby/home chassis
  | "light"; // on the paper manual

export interface ProfileButtonProps {
  /* "dark" = on chassis backgrounds, "light" = on the paper manual.
     Defaults to dark since most pages use that. */
  variant?: ProfileButtonVariant;
  /* If false, just shows the icon (used when chrome is tight, e.g. in
     the BombView header at mobile width). Defaults to true. */
  showLabel?: boolean;
  className?: string;
}

export function ProfileButton({
  variant = "dark",
  showLabel = true,
  className = "",
}: ProfileButtonProps) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  useEffect(() => setSessionId(getSessionId()), []);

  /* Lazy: only fetch once we have a real session id (avoids the SSR
     placeholder hitting the server). */
  const { data: user } = useQuery({
    queryKey: ["currentUser", sessionId],
    queryFn: () => getCurrentUser({ data: { sessionId } }),
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  const labelText = user?.username ?? "Profile";

  const palette =
    variant === "light"
      ? "text-ink/70 hover:text-ink border-ink/25 hover:border-ink/45 hover:bg-ink/5"
      : "text-bone-dim hover:text-bone border-rib hover:border-bone-dim/40 hover:bg-bone/8";

  return (
    <>
      <button
        onClick={() => {
          play("menuButton");
          setOpen(true);
        }}
        aria-label="Open settings"
        title={user ? `Signed in as ${user.username}` : "Settings"}
        className={`flex items-center gap-1.5 border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors ${palette} ${className}`}
      >
        <User size={13} strokeWidth={2.4} />
        {showLabel && (
          <span className="max-w-[8rem] truncate">{labelText}</span>
        )}
      </button>
      <SettingsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
