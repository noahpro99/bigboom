/* Shared wire renderer for every wire-style module.

   Uncut: a cylindrical wire body — the colour is shaded with a
   side-lit gradient so the centre highlight reads as a glossy
   PVC/rubber jacket, plus a subtle outer glow.

   Cut: the wire renders as TWO pieces with a visible dark gap between
   them, each end frayed with a darker tip and a tiny exposed copper
   bead. The bottom/second piece tilts a few degrees and slides
   sideways so it looks displaced after being severed. A short
   one-shot CSS animation springs the displaced piece into position
   (just on first render — re-renders don't restart it because the
   element identity stays the same). */

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
  /* Stable per-wire jitter — picks the cut tilt direction, the cut
     position, and the slide offset so adjacent cut wires don't look
     identical. */
  seed?: number;
}

const WIRE_THICKNESS = 12;

export function WireBody({
  color,
  stripeColor,
  length,
  orientation = "vertical",
  cut,
  seed = 0,
}: WireBodyProps) {
  const horizontal = orientation === "horizontal";

  /* Stable randomness based on seed. */
  const cutAt = 0.42 + (seed % 5) * 0.04; // 0.42..0.58
  const tiltDir = seed % 2 === 0 ? 1 : -1;
  const bottomTilt = 5 + (seed % 3) * 1.2; // 5..7.4 degrees
  const slideOffset = 2 + (seed % 3) * 0.7;

  const wireBg = stripeColor
    ? `repeating-linear-gradient(135deg, ${color} 0 5px, ${stripeColor} 5px 10px)`
    : sideLitGradient(color, horizontal);

  const insulationShadow = stripeColor
    ? `inset 0 0 0 1px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.55), 0 0 4px ${color}55`
    : `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 2px rgba(0,0,0,0.6), 0 0 5px ${color}66`;

  const containerStyle: React.CSSProperties = horizontal
    ? { width: length, height: WIRE_THICKNESS, position: "relative" }
    : { width: WIRE_THICKNESS, height: length, position: "relative" };

  if (!cut) {
    return (
      <div style={containerStyle}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: WIRE_THICKNESS / 2,
            background: wireBg,
            boxShadow: insulationShadow,
          }}
        />
      </div>
    );
  }

  /* Cut state — two halves with frayed copper ends. */
  const firstLen = `${(cutAt * 100).toFixed(1)}%`;
  const secondLen = `${((1 - cutAt - 0.04) * 100).toFixed(1)}%`;

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
      };

  /* Final transform of the second piece in the cut state. The CSS
     animation picks these up via CSS variables and springs to them. */
  const finalTx = horizontal ? slideOffset : tiltDir * slideOffset;
  const finalTy = horizontal ? tiltDir * 1.2 : slideOffset / 2;
  const finalRot = tiltDir * bottomTilt;

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
        ["--final-tx" as string]: `${finalTx}px`,
        ["--final-ty" as string]: `${finalTy}px`,
        ["--final-rot" as string]: `${finalRot}deg`,
      };

  return (
    <div style={containerStyle}>
      <div style={firstStyle}>
        <CopperEnd at={horizontal ? "right" : "bottom"} />
      </div>
      <div style={secondStyle} className="wire-snap">
        <CopperEnd at={horizontal ? "left" : "top"} />
      </div>
    </div>
  );
}

/* Side-lit gradient — produces a glossy cylindrical look. Two
   stacked gradients: a side-shading layer (front) and the base
   colour bracketed with darker edges along the length (back). */
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

/* Frayed copper end on a cut wire — a small darker insulation tip
   capped with a glowing copper bead. */
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
