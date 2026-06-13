import type { Module, WhosOnFirstModuleConfig } from "../../lib/types";
import { WHO_STAGES } from "../../lib/types";
import { play } from "../../lib/sound";

interface WhosOnFirstModuleProps {
  module: Module;
  disabled: boolean;
  onPress: (word: string) => void;
}

export function WhosOnFirstModule({
  module,
  disabled,
  onPress,
}: WhosOnFirstModuleProps) {
  const config = module.config as WhosOnFirstModuleConfig;
  const stageIdx = Math.min(
    module.state.whoStage ?? 0,
    config.stages.length - 1
  );
  const stage = config.stages[stageIdx];

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
        WHO·1st · MOD-W
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: WHO_STAGES }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full border ${
                i < stageIdx
                  ? "bg-phosphor border-phosphor shadow-[0_0_5px_#00f5a0]"
                  : "border-steel/60"
              }`}
            />
          ))}
        </div>
      </div>

      {/* The display — small LED-style readout showing the current
         display word. The defuser reads this aloud to the expert. */}
      <div className="mx-auto mb-4 bg-black/80 border border-steel/40 rounded-sm py-2 px-3 text-center">
        <div className="text-[8px] font-mono uppercase tracking-[0.3em] text-bone-dim/60 mb-0.5">
          Display
        </div>
        <div className="font-stencil text-amber-glow text-2xl sm:text-3xl tracking-[0.15em] leading-none led-glow-amber">
          {stage?.display ?? "—"}
        </div>
      </div>

      {/* 6 buttons in a 2×3 grid. Each prints its word in stencil
         lettering on the metal cap. */}
      <div className="grid grid-cols-2 gap-2">
        {stage?.buttons.map((word, i) => (
          <button
            key={`${stageIdx}-${i}`}
            disabled={disabled || module.solved}
            onClick={() => {
              if (disabled || module.solved) return;
              play("symbolPress");
              onPress(word);
            }}
            className={`btn-3d py-2.5 rounded-sm font-stencil text-bone text-[13px] sm:text-sm tracking-[0.15em] select-none ${
              disabled || module.solved
                ? "cursor-default"
                : "cursor-pointer"
            }`}
          >
            {word}
          </button>
        )) ?? null}
      </div>
    </div>
  );
}
