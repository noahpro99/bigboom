import { Star } from "lucide-react";
import type {
  Module,
  ComplicatedWiresModuleConfig,
  CompWire,
} from "../../lib/types";
import { play } from "../../lib/sound";
import { WireBody } from "./WireBody";

interface ComplicatedWiresModuleProps {
  module: Module;
  disabled: boolean;
  onCut: (slotIndex: number) => void;
}

export function ComplicatedWiresModule({
  module,
  disabled,
  onCut,
}: ComplicatedWiresModuleProps) {
  const config = module.config as ComplicatedWiresModuleConfig;
  const cut: number[] = module.state.cutCompWires ?? [];

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

  return (
    <div className={`bezel relative border ${borderColor} rounded-sm p-5 pt-7`}>
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        COMP-WIRES · MOD-C
      </div>

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* Wires laid out vertically. Each wire shows LED above and star
          beside it, with the slot itself coloured red, blue, or both
          (striped diagonally). */}
      <div className="relative flex justify-around py-4">
        {config.wires.map((wire, i) => {
          const isCut = cut.includes(i);
          const clickable = !disabled && !isCut && !module.solved;
          return (
            <CompWireSlot
              key={i}
              wire={wire}
              isCut={isCut}
              clickable={clickable}
              seed={i}
              onClick={() => {
                if (!clickable) return;
                play("wireSnip");
                onCut(i);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CompWireSlot({
  wire,
  isCut,
  clickable,
  seed,
  onClick,
}: {
  wire: CompWire;
  isCut: boolean;
  clickable: boolean;
  seed: number;
  onClick: () => void;
}) {
  /* The wire body — colour reflects the flags. Red/Blue → solid red
     or solid blue; both → diagonal red/blue stripes; neither → plain
     bone-coloured insulator. */
  const baseColor = wire.hasRed
    ? "#ef4444"
    : wire.hasBlue
    ? "#3b82f6"
    : "#8a93a8";
  const stripeColor =
    wire.hasRed && wire.hasBlue ? "#3b82f6" : undefined;

  return (
    <div className="relative flex flex-col items-center gap-1.5 w-8">
      {/* LED above the wire — bright phosphor when lit, dim socket
         when not. Always present so the slot reads the same height. */}
      <div
        className="w-3 h-3 rounded-full"
        style={
          wire.hasLED
            ? {
                background:
                  "radial-gradient(circle at 30% 25%, #c7ffe1 0%, #00f5a0 50%, #006a44 100%)",
                boxShadow: "0 0 8px #00f5a0, inset 0 1px 0 rgba(255,255,255,0.55)",
              }
            : {
                background:
                  "radial-gradient(circle at 30% 25%, #2a3346 0%, #1a2334 60%, #0a0f18 100%)",
                boxShadow:
                  "inset 0 0 0 1px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
              }
        }
      />

      <WireBody
        color={baseColor}
        stripeColor={stripeColor}
        length={60}
        orientation="vertical"
        cut={isCut}
        seed={seed}
        clickable={clickable}
        onClick={onClick}
        ariaLabel={`Complicated wire ${
          wire.hasRed ? "with red " : ""
        }${wire.hasBlue ? "with blue " : ""}${
          wire.hasStar ? "with star " : ""
        }${wire.hasLED ? "with LED" : ""}`}
      />

      {/* Star marker — small five-pointed glyph just below the slot. */}
      <div className="h-3 w-3 flex items-center justify-center">
        {wire.hasStar && (
          <Star
            size={11}
            strokeWidth={1.8}
            className="text-amber-glow"
            style={{
              filter:
                "drop-shadow(0 0 3px rgba(255,170,58,0.65)) drop-shadow(0 1px 0 rgba(0,0,0,0.6))",
            }}
            fill="currentColor"
          />
        )}
      </div>
    </div>
  );
}
