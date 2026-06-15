import { useRef, useState } from "react";
import { Scissors } from "lucide-react";

/* Shared wire renderer for every wire-style module.

   Uncut: a cylindrical wire body — the colour is shaded with a
   side-lit gradient so the centre highlight reads as a glossy
   PVC/rubber jacket, plus a subtle outer glow.

   Cut: the wire renders as TWO pieces with a visible dark gap between
   them, each end frayed with a darker tip and a tiny exposed copper
   bead. The bottom/second piece tilts a few degrees and slides
   sideways so it looks displaced after being severed.

   Hover + cut location: when `clickable` is true, the scissors icon
   tracks the pointer along the wire and the cut lands at whatever
   position the user actually clicked — not a fixed seeded ratio. We
   keep a seeded fallback (0.42..0.58) for the case where the wire
   was cut by someone else / on page refresh / via keyboard, so the
   visual still varies. */

export interface WireBodyProps {
  /* Primary wire colour (hex / css colour). */
  color: string;
  /* Optional second colour — when present, the wire is rendered as
     diagonal stripes (used by Complicated Wires for red+blue). */
  stripeColor?: string;
  /* Length along the wire axis. Width is fixed per orientation.
     Accepts a number (pixels) or a CSS string ("100%" for flex-fill). */
  length: number | string;
  orientation?: "vertical" | "horizontal";
  cut: boolean;
  /* Stable per-wire jitter — picks the seeded cut position and tilt
     direction so adjacent cut wires don't look identical when the
     real cut location is unknown. */
  seed?: number;
  /* Click + hover-tracking wiring. When `clickable` is true the
     wire shows the hover scissors, captures the click position, and
     calls onClick. The cut visual then uses the captured position. */
  clickable?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

const WIRE_THICKNESS = 12;

export function WireBody({
  color,
  stripeColor,
  length,
  orientation = "vertical",
  cut,
  seed = 0,
  clickable = false,
  onClick,
  ariaLabel,
}: WireBodyProps) {
  const horizontal = orientation === "horizontal";

  /* Hover position along the wire (0..1) — null when the pointer
     isn't over the wire. Drives scissors placement. */
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  /* Captured cut position — set at click time and used by the cut
     render. Stays put through re-renders so the cut animation lines
     up with where the user actually clicked. */
  const [capturedCut, setCapturedCut] = useState<number | null>(null);

  /* Stable randomness based on seed — used when the wire was cut by
     somebody else / via keyboard / on page refresh. */
  const seededCutAt = 0.42 + (seed % 5) * 0.04; // 0.42..0.58
  const tiltDir = seed % 2 === 0 ? 1 : -1;
  const bottomTilt = 5 + (seed % 3) * 1.2;
  const slideOffset = 2 + (seed % 3) * 0.7;

  const cutAt = capturedCut ?? seededCutAt;

  const wireRef = useRef<HTMLDivElement>(null);

  const wireBg = stripeColor
    ? `repeating-linear-gradient(135deg, ${color} 0 5px, ${stripeColor} 5px 10px)`
    : sideLitGradient(color, horizontal);

  const insulationShadow = stripeColor
    ? `inset 0 0 0 1px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.55), 0 0 4px ${color}55`
    : `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 2px rgba(0,0,0,0.6), 0 0 5px ${color}66`;

  const containerStyle: React.CSSProperties = horizontal
    ? { width: length, height: WIRE_THICKNESS, position: "relative" }
    : { width: WIRE_THICKNESS, height: length, position: "relative" };

  /* Convert a clientX/clientY into a 0..1 position along the wire.
     We clamp away from the very ends so the cut animation never
     produces a tiny stub piece (visually awkward). */
  function clientPos(clientX: number, clientY: number): number | null {
    if (!wireRef.current) return null;
    const rect = wireRef.current.getBoundingClientRect();
    const raw = horizontal
      ? (clientX - rect.left) / rect.width
      : (clientY - rect.top) / rect.height;
    return Math.max(0.12, Math.min(0.88, raw));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!clickable) return;
    const p = clientPos(e.clientX, e.clientY);
    if (p !== null) setHoverPos(p);
  }

  function handlePointerLeave() {
    setHoverPos(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!clickable) return;
    /* Capture position immediately so touch (which never fires
       pointermove first) still gets a precise cut location. */
    const p = clientPos(e.clientX, e.clientY);
    if (p !== null) setHoverPos(p);
  }

  function handleClick() {
    if (!clickable) return;
    setCapturedCut(hoverPos ?? seededCutAt);
    onClick?.();
  }

  /* Container that owns the click + pointer-tracking. When clickable
     we make it a real button for keyboard support. When not, a div. */
  const containerProps = clickable
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": ariaLabel,
        onClick: handleClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        },
        onPointerMove: handlePointerMove,
        onPointerLeave: handlePointerLeave,
        onPointerDown: handlePointerDown,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : { "aria-label": ariaLabel };

  const interactionStyle: React.CSSProperties = clickable
    ? {
        cursor: "pointer",
        touchAction: "none",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }
    : {};

  /* Uncut render — single wire body. */
  const wireSurface = !cut ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: WIRE_THICKNESS / 2,
        background: wireBg,
        boxShadow: insulationShadow,
        pointerEvents: "none",
      }}
    />
  ) : (
    cutPieces({
      cutAt,
      horizontal,
      wireBg,
      insulationShadow,
      tiltDir,
      bottomTilt,
      slideOffset,
    })
  );

  return (
    <div
      ref={wireRef}
      style={{ ...containerStyle, ...interactionStyle }}
      {...containerProps}
    >
      {wireSurface}

      {/* Hover scissors — follows the pointer along the wire. Stays
          out of the way of the click handler so the OS treats hovers
          and clicks normally. */}
      {clickable && !cut && hoverPos !== null && (
        <HoverScissors
          pos={hoverPos}
          orientation={orientation}
        />
      )}
    </div>
  );
}

/* Two-piece cut state: first piece anchored at the start, then a
   small dark gap, then the displaced second piece. Copper bead at
   each cut face. The second piece's final transform is exposed via
   CSS variables so the .wire-snap animation lands at the right pose
   regardless of orientation. */
function cutPieces({
  cutAt,
  horizontal,
  wireBg,
  insulationShadow,
  tiltDir,
  bottomTilt,
  slideOffset,
}: {
  cutAt: number;
  horizontal: boolean;
  wireBg: string;
  insulationShadow: string;
  tiltDir: number;
  bottomTilt: number;
  slideOffset: number;
}) {
  const firstLen = `${(cutAt * 100).toFixed(1)}%`;
  const secondLen = `${((1 - cutAt - 0.04) * 100).toFixed(1)}%`;
  const finalTx = horizontal ? slideOffset : tiltDir * slideOffset;
  const finalTy = horizontal ? tiltDir * 1.2 : slideOffset / 2;
  const finalRot = tiltDir * bottomTilt;

  const firstStyle: React.CSSProperties = horizontal
    ? {
        position: "absolute",
        left: 0,
        top: 0,
        width: firstLen,
        height: "100%",
        background: wireBg,
        boxShadow: insulationShadow,
        borderRadius: `${WIRE_THICKNESS / 2}px 2px 2px ${WIRE_THICKNESS / 2}px`,
        pointerEvents: "none",
      }
    : {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: firstLen,
        background: wireBg,
        boxShadow: insulationShadow,
        borderRadius: `${WIRE_THICKNESS / 2}px ${WIRE_THICKNESS / 2}px 2px 2px`,
        pointerEvents: "none",
      };

  const secondStyle: React.CSSProperties = horizontal
    ? {
        position: "absolute",
        right: 0,
        top: 0,
        width: secondLen,
        height: "100%",
        background: wireBg,
        boxShadow: insulationShadow,
        borderRadius: `2px ${WIRE_THICKNESS / 2}px ${WIRE_THICKNESS / 2}px 2px`,
        transformOrigin: "left center",
        pointerEvents: "none",
        ["--final-tx" as string]: `${finalTx}px`,
        ["--final-ty" as string]: `${finalTy}px`,
        ["--final-rot" as string]: `${finalRot}deg`,
      }
    : {
        position: "absolute",
        left: 0,
        bottom: 0,
        width: "100%",
        height: secondLen,
        background: wireBg,
        boxShadow: insulationShadow,
        borderRadius: `2px 2px ${WIRE_THICKNESS / 2}px ${WIRE_THICKNESS / 2}px`,
        transformOrigin: "top center",
        pointerEvents: "none",
        ["--final-tx" as string]: `${finalTx}px`,
        ["--final-ty" as string]: `${finalTy}px`,
        ["--final-rot" as string]: `${finalRot}deg`,
      };

  return (
    <>
      <div style={firstStyle}>
        <CopperEnd at={horizontal ? "right" : "bottom"} />
      </div>
      <div style={secondStyle} className="wire-snap">
        <CopperEnd at={horizontal ? "left" : "top"} />
      </div>
    </>
  );
}

/* Side-lit gradient — produces a glossy cylindrical look. */
function sideLitGradient(color: string, horizontal: boolean): string {
  const sideAxis = horizontal ? "0deg" : "90deg";
  const lengthAxis = horizontal ? "90deg" : "0deg";
  return `
    linear-gradient(${sideAxis},
      rgba(0,0,0,0.55) 0%,
      rgba(0,0,0,0.2) 14%,
      rgba(255,255,255,0.0) 30%,
      rgba(255,255,255,0.45) 46%,
      rgba(255,255,255,0.65) 50%,
      rgba(255,255,255,0.45) 54%,
      rgba(255,255,255,0.0) 70%,
      rgba(0,0,0,0.2) 86%,
      rgba(0,0,0,0.55) 100%
    ),
    linear-gradient(${lengthAxis},
      color-mix(in srgb, ${color} 65%, #000) 0%,
      ${color} 6%,
      ${color} 94%,
      color-mix(in srgb, ${color} 65%, #000) 100%
    )
  `.replace(/\s+/g, " ");
}

function CopperEnd({ at }: { at: "top" | "bottom" | "left" | "right" }) {
  const horizontal = at === "left" || at === "right";
  return (
    <span
      style={{
        position: "absolute",
        ...(at === "top" && { top: 0, left: "50%", transform: "translate(-50%, -45%)" }),
        ...(at === "bottom" && { bottom: 0, left: "50%", transform: "translate(-50%, 45%)" }),
        ...(at === "left" && { left: 0, top: "50%", transform: "translate(-45%, -50%)" }),
        ...(at === "right" && { right: 0, top: "50%", transform: "translate(45%, -50%)" }),
        width: horizontal ? 7 : 8,
        height: horizontal ? 8 : 7,
        borderRadius: 2,
        background:
          "radial-gradient(circle at 35% 35%, #ffd596 0%, #d18432 45%, #6a3608 100%)",
        boxShadow:
          "0 0 4px rgba(255,170,90,0.55), inset 0 0 0 0.5px rgba(0,0,0,0.5)",
        pointerEvents: "none",
      }}
    />
  );
}

/* Hovering scissors icon that tracks the pointer along the wire. */
function HoverScissors({
  pos,
  orientation,
}: {
  pos: number;
  orientation: "vertical" | "horizontal";
}) {
  const horizontal = orientation === "horizontal";
  const pct = `${(pos * 100).toFixed(1)}%`;
  return (
    <Scissors
      size={26}
      strokeWidth={2}
      style={{
        position: "absolute",
        color: "var(--color-bone, #e7eaf0)",
        pointerEvents: "none",
        ...(horizontal
          ? { left: pct, top: "50%", transform: "translate(-50%, -50%)" }
          : { top: pct, left: "50%", transform: "translate(-50%, -50%)" }),
        filter:
          "drop-shadow(0 0 0 #050a14) drop-shadow(0 1px 0 #050a14) drop-shadow(0 -1px 0 #050a14) drop-shadow(1px 0 0 #050a14) drop-shadow(-1px 0 0 #050a14) drop-shadow(0 3px 6px rgba(0,0,0,0.95))",
      }}
    />
  );
}
