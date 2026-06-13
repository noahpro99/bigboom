import { Scissors } from "lucide-react";
import type {
  Module,
  WireSeqModuleConfig,
  WireSeqColor,
} from "../../lib/types";
import { play } from "../../lib/sound";

interface WireSequencesModuleProps {
  module: Module;
  disabled: boolean;
  onCut: (slotIndex: number) => void;
}

const WIRE_COLORS: Record<WireSeqColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  black: "#374151",
};

export function WireSequencesModule({
  module,
  disabled,
  onCut,
}: WireSequencesModuleProps) {
  const config = module.config as WireSeqModuleConfig;
  const cut: number[] = module.state.cutWireSeqs ?? [];

  const borderColor = module.solved
    ? "border-phosphor/50"
    : module.struck
    ? "border-crimson/60"
    : "border-steel/50";

  const statusDot = module.solved
    ? "bg-phosphor shadow-[0_0_8px_#00f5a0]"
    : module.struck
    ? "bg-crimson shadow-[0_0_8px_#e0245e] led-glow-red"
    : "bg-amber-glow shadow-[0_0_6px_#ffaa3a] pulse-dot";

  /* Compute the running occurrence for each wire so the bomb can
     LABEL it explicitly — KTaNE shows just the colour, but for our
     mostly-mobile audience we print "R3" (3rd red), "B1", etc. next
     to each row. The defuser reads this aloud to the expert. */
  const occurrence: number[] = [];
  const seen: Record<WireSeqColor, number> = { red: 0, blue: 0, black: 0 };
  for (const w of config.wires) {
    seen[w.color]++;
    occurrence.push(seen[w.color]);
  }

  return (
    <div className={`bezel relative border ${borderColor} rounded-sm p-5 pt-7`}>
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        WIRE-SEQ · MOD-Q
      </div>

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* Vertical list of wires. Each row: occurrence chip (e.g. R3) on
         the left, the horizontal wire body in the middle (clickable),
         and the letter card on the right. */}
      <div className="flex flex-col gap-1.5">
        {config.wires.map((wire, i) => {
          const isCut = cut.includes(i);
          const clickable = !disabled && !isCut && !module.solved;
          const colorHex = WIRE_COLORS[wire.color];
          return (
            <button
              key={i}
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return;
                play("wireSnip");
                onCut(i);
              }}
              className={`relative flex items-center gap-2 px-1 py-1 ${
                isCut ? "wire-cut" : ""
              } ${clickable ? "cursor-pointer group" : "cursor-default"}`}
              aria-label={`${wire.color} wire #${occurrence[i]} (letter ${wire.letter})`}
            >
              <span
                className="shrink-0 w-9 text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-bone-dim text-center"
                style={{ color: colorHex }}
              >
                {wire.color[0].toUpperCase()}
                {occurrence[i]}
              </span>
              <div
                className="flex-1 h-3 rounded-full relative"
                style={{
                  background: `linear-gradient(90deg, color-mix(in srgb, ${colorHex} 55%, #000) 0%, ${colorHex} 35%, color-mix(in srgb, ${colorHex} 70%, #fff) 55%, ${colorHex} 85%, color-mix(in srgb, ${colorHex} 60%, #000) 100%)`,
                  boxShadow: `0 0 4px ${colorHex}80, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.45)`,
                  opacity: isCut ? 0.28 : 1,
                }}
              />
              <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-sm border border-steel/55 bg-black/55 font-stencil text-bone text-base">
                {wire.letter}
              </span>
              {clickable && (
                <Scissors
                  size={20}
                  strokeWidth={2}
                  className="text-bone absolute left-[48%] top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    filter:
                      "drop-shadow(0 0 0 #050a14) drop-shadow(0 1px 0 #050a14) drop-shadow(0 -1px 0 #050a14) drop-shadow(1px 0 0 #050a14) drop-shadow(-1px 0 0 #050a14) drop-shadow(0 3px 6px rgba(0,0,0,0.95))",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
