import type { Module, MemoryModuleConfig, MemoryPress } from "../../lib/types";
import { MEMORY_STAGES } from "../../lib/types";
import { play } from "../../lib/sound";

interface MemoryModuleProps {
  module: Module;
  disabled: boolean;
  onPress: (position: number) => void;
}

export function MemoryModule({ module, disabled, onPress }: MemoryModuleProps) {
  const config = module.config as MemoryModuleConfig;
  const history: MemoryPress[] = module.state.memoryHistory ?? [];
  const stageIdx = Math.min(history.length, MEMORY_STAGES - 1);
  const stage = config.stages[stageIdx];
  const onLastStage = history.length === MEMORY_STAGES;

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
        MEMORY · MOD-R
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: MEMORY_STAGES }).map((_, i) => {
            const done = i < history.length;
            return (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full border ${
                  done
                    ? "bg-phosphor border-phosphor shadow-[0_0_5px_#00f5a0]"
                    : "border-steel/60"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Seven-segment-ish display showing the stage number to look up */}
      <div
        className="mx-auto mb-4 flex flex-col items-center justify-center bg-black border border-steel/40 rounded-sm px-4 py-3"
        style={{ width: 130 }}
      >
        <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-bone-dim/60">
          {onLastStage ? "DONE" : `STAGE ${stageIdx + 1}`}
        </div>
        <div
          className={`led-timer text-5xl ${
            module.solved
              ? "led-glow-green"
              : module.struck
              ? "led-glow-red"
              : "led-glow-amber"
          }`}
        >
          {onLastStage ? "—" : stage.display}
        </div>
      </div>

      {/* Four buttons — labels are the per-stage permutation. */}
      <div className="grid grid-cols-4 gap-2">
        {stage.labels.map((label, i) => {
          const position = i + 1;
          const isDisabled = disabled || module.solved || onLastStage;
          return (
            <button
              key={position}
              disabled={isDisabled}
              onClick={() => {
                if (isDisabled) return;
                play("symbolPress");
                onPress(position);
              }}
              className={`btn-3d aspect-square rounded-sm flex items-center justify-center font-stencil text-2xl text-bone select-none ${
                isDisabled ? "cursor-default" : "cursor-pointer"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* History strip — the Defuser needs to remember what they pressed
          in past stages, since later rules may reference them. Compact
          row of position+label per solved stage. */}
      {history.length > 0 && !module.solved && (
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[9px] font-mono">
          {history.map((h, i) => (
            <span
              key={i}
              className="border border-steel/40 px-1.5 py-0.5 bg-black/40 text-bone tracking-[0.15em]"
              title={`stage ${i + 1}: position ${h.position}, label ${h.label}`}
            >
              {h.position}/{h.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
