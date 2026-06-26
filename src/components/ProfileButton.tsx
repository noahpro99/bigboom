import { useState } from "react";
import { Settings } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { play } from "../lib/sound";

/* Modal-launcher: small gear icon, no text. Drops cleanly into any
   page header without crowding existing chrome. */

export type ProfileButtonVariant =
  | "dark" // on the bomb/lobby/home chassis
  | "light"; // on the paper manual

export interface ProfileButtonProps {
  variant?: ProfileButtonVariant;
  showLabel?: boolean;
  className?: string;
  onGiveUp?: () => void;
}

export function ProfileButton({
  variant = "dark",
  className = "",
  onGiveUp,
}: ProfileButtonProps) {
  const [open, setOpen] = useState(false);

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
        title="Settings"
        className={`inline-flex items-center justify-center border p-1.5 transition-colors ${palette} ${className}`}
      >
        <Settings size={16} strokeWidth={2.2} />
      </button>
      <SettingsModal open={open} onClose={() => setOpen(false)} onGiveUp={onGiveUp} />
    </>
  );
}
