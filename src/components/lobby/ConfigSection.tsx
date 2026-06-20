import { useEffect, useRef, useState } from "react";
import { Bomb, Loader2, Skull, AlertTriangle } from "lucide-react";
import { play } from "../../lib/sound";
import type { ModuleType, Preset } from "../../lib/types";
import {
  ALL_OPTIONAL_MODULES,
  MAX_INSTANCES_PER_TYPE,
  estimateTimerSeconds,
  moduleCounts,
  moduleTypesFromCounts,
} from "../../lib/types";

/* Preset selector + collapsed Advanced drawer. Shared between the online
   lobby (src/routes/game.$gameId.tsx) and the offline setup
   (src/routes/offline.tsx). Sends the updated config up via onChange;
   the caller decides what the source of truth is (server poll online,
   local React state offline). */
export const PRESET_META: Array<{
  preset: Exclude<Preset, "custom">;
  label: string;
  sub: string;
  Icon: typeof Bomb;
}> = [
  { preset: "quick", label: "Quick", sub: "3 min · 4 modules", Icon: Loader2 },
  { preset: "standard", label: "Standard", sub: "5 min · 6 modules", Icon: Bomb },
  { preset: "hardcore", label: "Hardcore", sub: "8 min · all 8", Icon: Skull },
];

export const MODULE_META: Record<ModuleType, { label: string; sub: string }> = {
  wire: { label: "Wires", sub: "MOD-A" },
  button: { label: "Button", sub: "MOD-B" },
  symbols: { label: "Symbols", sub: "MOD-S" },
  simon: { label: "Simon", sub: "MOD-Σ" },
  maze: { label: "Maze", sub: "MOD-M" },
  memory: { label: "Memory", sub: "MOD-R" },
  morse: { label: "Morse", sub: "MOD-T" },
  password: { label: "Password", sub: "MOD-P" },
  compWires: { label: "Comp-Wires", sub: "MOD-C" },
  whoFirst: { label: "Who's 1st", sub: "MOD-W" },
  wireSeq: { label: "Wire-Seq", sub: "MOD-Q" },
};

export function ConfigSection({
  preset,
  timerSeconds,
  moduleTypes,
  onChange,
  pending,
}: {
  preset: Preset;
  timerSeconds: number;
  moduleTypes: ModuleType[];
  onChange: (next: {
    preset?: Preset;
    timerSeconds?: number;
    moduleTypes?: ModuleType[];
  }) => void;
  pending: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(preset === "custom");
  const counts = moduleCounts(moduleTypes);

  const [localTimer, setLocalTimer] = useState(timerSeconds);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setLocalTimer(timerSeconds);
  }, [timerSeconds]);

  function pickPreset(p: Exclude<Preset, "custom">) {
    if (preset === p) return;
    play("menuButton");
    onChange({ preset: p });
  }

  function bumpModule(t: ModuleType, delta: number) {
    const cur = counts[t];
    const next = Math.max(0, Math.min(MAX_INSTANCES_PER_TYPE, cur + delta));
    if (next === cur) return;
    play("menuButton");
    const nextCounts = { ...counts, [t]: next };
    const nextTypes = moduleTypesFromCounts(nextCounts);
    /* Module changes auto-suggest a fitting timer so the host doesn't
       have to remember to retune it. The slider remains the final
       authority — if they adjust it afterwards, that's their answer. */
    onChange({
      timerSeconds: estimateTimerSeconds(nextTypes),
      moduleTypes: nextTypes,
    });
  }

  function commitTimer(value: number) {
    if (value === timerSeconds) return;
    onChange({ timerSeconds: value, moduleTypes });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
          Bomb Configuration
        </span>
        {pending && (
          <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-amber/80 flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Updating
          </span>
        )}
      </div>

      {/* Preset row — three radio-style chassis tiles. */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PRESET_META.map((p) => {
          const active = preset === p.preset;
          return (
            <button
              key={p.preset}
              disabled={pending}
              onClick={() => pickPreset(p.preset)}
              className={`relative px-2 py-2 border transition-all text-left disabled:opacity-60 ${
                active
                  ? "border-amber/60 bg-amber/8"
                  : "border-rib hover:border-steel-light"
              }`}
            >
              <div
                className={`font-stencil text-sm tracking-wider uppercase ${
                  active ? "text-amber-glow" : "text-bone-dim"
                }`}
              >
                {p.label}
              </div>
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-bone-dim/60 leading-tight">
                {p.sub}
              </div>
            </button>
          );
        })}
      </div>
      {preset === "custom" && (
        <div className="mb-3 flex items-center gap-2 border border-amber/40 bg-amber/8 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.22em] text-amber/90">
          <AlertTriangle size={11} />
          <span>Custom — not counted in stats.</span>
        </div>
      )}

      {/* Advanced drawer */}
      <button
        onClick={() => {
          play("menuButton");
          setAdvancedOpen((v) => !v);
        }}
        className="w-full text-left text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim hover:text-bone transition-colors flex items-center gap-1.5"
      >
        <span>{advancedOpen ? "▾" : "▸"}</span>
        Advanced
      </button>
      {advancedOpen && (
        <div className="mt-3 space-y-4 border-t border-rib/60 pt-3">
          {/* Timer slider — module changes pre-fill an estimate; drag
              from there to fine-tune. To re-snap to the auto value,
              bump any module count and back. */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Timer
              </span>
              <span className="font-mono text-xs text-amber tabular-nums">
                {Math.floor(localTimer / 60)}m{" "}
                {String(localTimer % 60).padStart(2, "0")}s
              </span>
            </div>
            <input
              type="range"
              min={60}
              max={900}
              step={30}
              value={localTimer}
              disabled={pending}
              onChange={(e) => setLocalTimer(Number(e.currentTarget.value))}
              onPointerDown={() => {
                draggingRef.current = true;
              }}
              onPointerUp={() => {
                draggingRef.current = false;
                commitTimer(localTimer);
              }}
              onPointerCancel={() => {
                draggingRef.current = false;
              }}
              onKeyUp={() => commitTimer(localTimer)}
              className="bigboom-slider w-full"
              aria-label="Timer in seconds"
            />
          </div>

          {/* Module counts — +/- picker per type. Wire & button are
              core (min 1), the rest start at 0. Anything above 1 is
              a "multi-instance" bomb — each module type still gets a
              single manual page. */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
                Modules
              </span>
              <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-bone-dim/55">
                count
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["wire", "button", ...ALL_OPTIONAL_MODULES] as ModuleType[]).map(
                (t) => {
                  const meta = MODULE_META[t];
                  const count = counts[t];
                  const enabled = count > 0;
                  return (
                    <div
                      key={t}
                      className={`px-2.5 py-1.5 border flex items-center justify-between gap-2 ${
                        enabled
                          ? "border-phosphor/45 bg-phosphor/8"
                          : "border-rib"
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`font-stencil text-sm tracking-wide uppercase truncate ${
                            enabled ? "text-phosphor" : "text-bone-dim"
                          }`}
                        >
                          {meta.label}
                        </div>
                        <div className="text-[8px] font-mono uppercase tracking-[0.22em] text-bone-dim/55">
                          {meta.sub}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => bumpModule(t, -1)}
                          disabled={pending || count <= 0}
                          className="w-6 h-6 border border-rib bg-void/40 text-bone-dim hover:text-bone hover:border-steel-light disabled:opacity-30 flex items-center justify-center font-mono"
                          aria-label={`Decrease ${meta.label}`}
                        >
                          −
                        </button>
                        <span
                          className={`min-w-[1.5ch] text-center font-stencil text-base ${
                            enabled ? "text-phosphor" : "text-bone-dim/60"
                          }`}
                        >
                          {count}
                        </span>
                        <button
                          onClick={() => bumpModule(t, 1)}
                          disabled={pending || count >= MAX_INSTANCES_PER_TYPE}
                          className="w-6 h-6 border border-rib bg-void/40 text-bone-dim hover:text-bone hover:border-steel-light disabled:opacity-30 flex items-center justify-center font-mono"
                          aria-label={`Increase ${meta.label}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
