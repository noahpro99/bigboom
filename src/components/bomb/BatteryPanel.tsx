/* Battery pack panel — mounted to the bomb chassis, visible in the
   header strip beside the serial sticker. Drawn as real cells in a
   recessed black socket so it reads as a part of the bomb hardware,
   not as a UI badge. */

interface BatteryPanelProps {
  count: number;
}

export function BatteryPanel({ count }: BatteryPanelProps) {
  if (count <= 0) return null;
  return (
    <div
      className="inline-flex items-end gap-1 border border-steel/55 bg-black/60 rounded-sm px-1.5 py-1"
      style={{
        /* deep socket — light catches the lip, bottom is recessed */
        boxShadow:
          "inset 0 1.5px 3px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(255,255,255,0.04)",
      }}
      aria-label={`${count} batter${count === 1 ? "y" : "ies"}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Battery key={i} />
      ))}
    </div>
  );
}

/* A single AA-style cell drawn at ~12×26 logical units, then scaled by
   the viewBox so we can size it via CSS without redrawing. */
function Battery() {
  return (
    <svg
      viewBox="0 0 12 28"
      width="11"
      height="26"
      className="block"
      aria-hidden
    >
      <defs>
        <linearGradient id="batCap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8ecf2" />
          <stop offset="55%" stopColor="#9aa3b5" />
          <stop offset="100%" stopColor="#4e5466" />
        </linearGradient>
        <linearGradient id="batBody" x1="0" y1="0" x2="1" y2="0">
          {/* horizontal — gives the cylinder a left-to-right specular */}
          <stop offset="0%" stopColor="#5a0c0c" />
          <stop offset="25%" stopColor="#bd2424" />
          <stop offset="55%" stopColor="#e85c5c" />
          <stop offset="75%" stopColor="#a01818" />
          <stop offset="100%" stopColor="#3a0606" />
        </linearGradient>
        <linearGradient id="batStripe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a0606" />
          <stop offset="100%" stopColor="#0a0202" />
        </linearGradient>
      </defs>

      {/* Positive terminal cap — sits on top, slightly narrower. */}
      <rect x="4" y="0" width="4" height="3" fill="url(#batCap)" rx="0.4" />
      <rect x="4" y="0" width="4" height="0.6" fill="rgba(255,255,255,0.55)" />

      {/* Body — full cylinder. */}
      <rect
        x="0.4"
        y="3"
        width="11.2"
        height="24"
        rx="1.2"
        fill="url(#batBody)"
        stroke="#1a0303"
        strokeWidth="0.4"
      />

      {/* Top + bottom band — typical alkaline-cell trim. */}
      <rect x="0.4" y="3" width="11.2" height="1.4" fill="url(#batStripe)" />
      <rect x="0.4" y="25.4" width="11.2" height="1.6" fill="url(#batStripe)" />

      {/* + symbol near the top. */}
      <g
        fill="#fff"
        fontSize="3.8"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="bold"
        textAnchor="middle"
      >
        <text x="6" y="8.5">+</text>
      </g>

      {/* − symbol near the bottom. */}
      <g
        stroke="#fff"
        strokeWidth="0.7"
        strokeLinecap="round"
      >
        <line x1="4.4" y1="23" x2="7.6" y2="23" />
      </g>
    </svg>
  );
}
