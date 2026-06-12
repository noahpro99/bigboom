import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isMuted, setMuted, subscribeMuted, play } from "../lib/sound";

interface MuteButtonProps {
  variant?: "dark" | "light";
  className?: string;
}

export function MuteButton({ variant = "dark", className = "" }: MuteButtonProps) {
  // React's official primitive for external-store subscriptions. Avoids the
  // useState+useEffect race that left the icon stuck on the previous value.
  const muted = useSyncExternalStore(
    subscribeMuted,
    () => isMuted(),
    () => false
  );

  const Icon = muted ? VolumeX : Volume2;

  function toggle() {
    const next = !muted;
    setMuted(next);
    if (!next) play("menuButton");
  }

  const palette =
    variant === "light"
      ? "text-ink/60 hover:text-ink hover:bg-ink/8 border-ink/20"
      : "text-bone-dim hover:text-bone hover:bg-bone/8 border-rib";

  return (
    <button
      onClick={toggle}
      aria-label={muted ? "Unmute" : "Mute"}
      title={muted ? "Unmute" : "Mute"}
      className={`p-2 border rounded-sm transition-colors ${palette} ${className}`}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
