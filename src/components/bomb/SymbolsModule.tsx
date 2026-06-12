import { Check } from "lucide-react";
import type { Module, SymbolsModuleConfig } from "../../lib/types";
import { play } from "../../lib/sound";

interface SymbolsModuleProps {
  module: Module;
  disabled: boolean;
  onPress: (symbolId: string) => void;
}

function GlyphSvg({
  paths,
  className,
}: {
  paths: string[];
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="6"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function SymbolsModule({
  module,
  disabled,
  onPress,
}: SymbolsModuleProps) {
  const config = module.config as SymbolsModuleConfig;
  const pressedIds: string[] = module.state.pressedIds ?? [];
  const total = config.activeSymbols.length;

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
        SYMBOLS · MOD-S
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* Progress pip row */}
      <div className="flex justify-center gap-2 mb-4">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < pressedIds.length;
          return (
            <div
              key={i}
              className={`w-2 h-2 rounded-full border transition-all ${
                done
                  ? "bg-phosphor border-phosphor shadow-[0_0_6px_#00f5a0]"
                  : "bg-transparent border-steel/60"
              }`}
            />
          );
        })}
      </div>

      {/* 2×2 symbol grid — each cell is a 3D push-button */}
      <div className="grid grid-cols-2 gap-4 pt-1 pb-2">
        {config.activeSymbols.map((sym) => {
          const pressed = pressedIds.includes(sym.id);
          const isInteractable = !disabled && !module.solved && !pressed;

          return (
            <button
              key={sym.id}
              disabled={!isInteractable}
              onClick={() => {
                if (!isInteractable) return;
                play("symbolPress");
                onPress(sym.id);
              }}
              className={`relative flex items-center justify-center w-full h-20 rounded-md select-none group ${
                pressed ? "btn-3d btn-3d-armed btn-3d-press" : "btn-3d"
              } ${
                isInteractable ? "cursor-pointer" : "cursor-default"
              } ${!isInteractable && !pressed ? "opacity-60" : ""}`}
            >
              <div className="relative w-14 h-14">
                <GlyphSvg
                  paths={sym.paths}
                  className={`w-full h-full transition-colors drop-shadow-[0_1px_0_rgba(0,0,0,0.6)] ${
                    pressed ? "text-phosphor" : "text-bone"
                  }`}
                />
                {pressed && (
                  <div className="absolute -top-2 -right-2">
                    <div className="w-5 h-5 rounded-full bg-phosphor/90 shadow-[0_0_8px_#00f5a0] border border-phosphor flex items-center justify-center">
                      <Check size={11} className="text-void" strokeWidth={3} />
                    </div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {!module.solved && (
        <p className="mt-3 text-[9px] text-bone-dim/60 font-mono text-center tracking-widest uppercase">
          {pressedIds.length === 0
            ? "Describe symbols to Expert · press in their order"
            : `${pressedIds.length} / ${total} pressed`}
        </p>
      )}
    </div>
  );
}
