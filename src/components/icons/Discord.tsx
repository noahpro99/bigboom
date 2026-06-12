import { siDiscord } from "simple-icons";

interface DiscordIconProps {
  size?: number;
  className?: string;
}

export function DiscordIcon({ size = 20, className }: DiscordIconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-label="Discord"
    >
      <path d={siDiscord.path} />
    </svg>
  );
}
