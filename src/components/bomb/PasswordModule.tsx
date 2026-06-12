import { ChevronUp, ChevronDown } from "lucide-react";
import type { Module, PasswordModuleConfig } from "../../lib/types";
import { PASSWORD_COLS, PASSWORD_LETTERS_PER_COL } from "../../lib/types";
import { play } from "../../lib/sound";

interface PasswordModuleProps {
  module: Module;
  disabled: boolean;
  onCycle: (col: number, delta: number) => void;
  onSubmit: () => void;
}

export function PasswordModule({
  module,
  disabled,
  onCycle,
  onSubmit,
}: PasswordModuleProps) {
  const config = module.config as PasswordModuleConfig;
  const dials = module.state.passwordDials ?? new Array(PASSWORD_COLS).fill(0);

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

  function cycle(col: number, delta: number) {
    if (disabled || module.solved) return;
    play("symbolPress");
    onCycle(col, delta);
  }

  function submit() {
    if (disabled || module.solved) return;
    play("buttonDown");
    onSubmit();
  }

  return (
    <div className={`bezel relative border ${borderColor} rounded-sm p-5 pt-7`}>
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        PASSWORD · MOD-P
      </div>

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* 5 columns each with up/letter/down stacked. Letter face looks
          like a rotating drum: prev letter peeking above, current
          letter highlighted, next letter peeking below. */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {config.columns.map((letters, col) => {
          const idx = dials[col] ?? 0;
          const prev =
            letters[(idx - 1 + PASSWORD_LETTERS_PER_COL) % PASSWORD_LETTERS_PER_COL];
          const cur = letters[idx];
          const next = letters[(idx + 1) % PASSWORD_LETTERS_PER_COL];

          return (
            <div key={col} className="flex flex-col items-center gap-1">
              <button
                disabled={disabled || module.solved}
                onClick={() => cycle(col, -1)}
                className="btn-3d w-full h-6 rounded-sm flex items-center justify-center text-bone"
                aria-label={`Column ${col + 1} up`}
              >
                <ChevronUp size={14} strokeWidth={3} />
              </button>
              <div
                className="relative w-full bg-black border border-steel/40 flex flex-col items-center py-1 select-none overflow-hidden"
                style={{ height: 64 }}
              >
                <span className="font-stencil text-[10px] text-bone-dim/40 leading-none">
                  {prev}
                </span>
                <span
                  className={`font-stencil text-2xl leading-tight ${
                    module.solved ? "text-phosphor" : "text-amber-glow"
                  }`}
                  style={{
                    textShadow: module.solved
                      ? "0 0 8px #00f5a0"
                      : "0 0 8px #ffaa3a",
                  }}
                >
                  {cur}
                </span>
                <span className="font-stencil text-[10px] text-bone-dim/40 leading-none">
                  {next}
                </span>
                {/* Centre rule — like the read head of a drum dial */}
                <div className="absolute left-0 right-0 top-1/2 -translate-y-px h-px bg-amber-glow/30 pointer-events-none" />
              </div>
              <button
                disabled={disabled || module.solved}
                onClick={() => cycle(col, 1)}
                className="btn-3d w-full h-6 rounded-sm flex items-center justify-center text-bone"
                aria-label={`Column ${col + 1} down`}
              >
                <ChevronDown size={14} strokeWidth={3} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        disabled={disabled || module.solved}
        onClick={submit}
        className="btn-3d w-full py-2.5 rounded-sm font-stencil tracking-[0.3em] text-base text-bone flex items-center justify-center disabled:opacity-60"
      >
        SUBMIT
      </button>
    </div>
  );
}
