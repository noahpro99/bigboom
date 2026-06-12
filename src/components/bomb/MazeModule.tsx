import { useEffect } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Module, MazeModuleConfig, Direction, MazeCell } from "../../lib/types";
import { MAZE_SIZE } from "../../lib/types";
import { play } from "../../lib/sound";

interface MazeModuleProps {
  module: Module;
  disabled: boolean;
  onMove: (direction: Direction) => void;
}

/* Render only the cells the player needs to find their maze:
   - The 2 green identification markers
   - The current position (white circle, drawn at the live `mazePos`)
   - The goal (red triangle)
   The walls themselves are NOT drawn on the bomb — that's the
   manual's job. The player has to ID the maze from the markers. */
export function MazeModule({ module, disabled, onMove }: MazeModuleProps) {
  const config = module.config as MazeModuleConfig;
  const active = config.pool[config.activeIndex];
  const currentPos: MazeCell = module.state.mazePos ?? config.start;
  const trail: MazeCell[] = module.state.mazeTrail ?? [config.start];

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

  /* Keyboard movement — feels native for this kind of module.
     Defuser tab only; if disabled, do nothing. */
  useEffect(() => {
    if (disabled || module.solved) return;
    function onKey(e: KeyboardEvent) {
      const isInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA";
      if (isInput) return;
      let dir: Direction | null = null;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") dir = "up";
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") dir = "down";
      else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") dir = "left";
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") dir = "right";
      if (!dir) return;
      e.preventDefault();
      play("symbolPress");
      onMove(dir);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, module.solved, onMove]);

  function fire(dir: Direction) {
    if (disabled || module.solved) return;
    play("symbolPress");
    onMove(dir);
  }

  /* Visual size — fit into the module without overrunning. */
  const cells = Array.from({ length: MAZE_SIZE * MAZE_SIZE }, (_, i) => ({
    x: i % MAZE_SIZE,
    y: Math.floor(i / MAZE_SIZE),
  }));

  return (
    <div className={`bezel relative border ${borderColor} rounded-sm p-5 pt-7`}>
      <span className="screw top-1.5 left-1.5" />
      <span className="screw top-1.5 right-1.5" />
      <span className="screw bottom-1.5 left-1.5" />
      <span className="screw bottom-1.5 right-1.5" />

      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-chassis px-3 py-1 text-sm font-stencil tracking-[0.18em] text-bone border border-steel/60">
        MAZE · MOD-M
      </div>

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-bone-dim">
            {module.solved ? "DEFUSED" : module.struck ? "STRUCK" : "ARMED"}
          </span>
        </div>
      </div>

      {/* The display — dotted grid of cells, no walls drawn. */}
      <div className="mx-auto bg-black/60 border border-steel/40 p-2 rounded-sm">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${MAZE_SIZE}, 1fr)` }}
        >
          {cells.map(({ x, y }) => {
            const isMarker = active.markers.some(
              (m) => m.x === x && m.y === y
            );
            const isCurrent = currentPos.x === x && currentPos.y === y;
            const isGoal = config.goal.x === x && config.goal.y === y;
            const isTrail =
              !isCurrent &&
              trail.some((t) => t.x === x && t.y === y);

            return (
              <div
                key={`${x}-${y}`}
                className="aspect-square relative bg-zinc-950 border border-steel/15 flex items-center justify-center"
              >
                {/* Dotted-grid hint — tiny pip in the centre of every cell so
                    the grid reads as a 6×6 board even when most cells are empty. */}
                {!isMarker && !isCurrent && !isGoal && !isTrail && (
                  <span className="w-[3px] h-[3px] rounded-full bg-steel/40" />
                )}
                {isTrail && (
                  <span className="w-1.5 h-1.5 rounded-full bg-phosphor/40" />
                )}
                {isMarker && !isCurrent && !isGoal && (
                  <span
                    className="w-3/4 h-3/4 rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle at 35% 30%, #6dffaf 0%, #14b86b 60%, #094a2a 100%)",
                      boxShadow:
                        "0 0 6px #14b86b, inset 0 1px 0 rgba(255,255,255,0.45)",
                    }}
                  />
                )}
                {isCurrent && (
                  <span
                    className="w-3/4 h-3/4 rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle at 32% 28%, #ffffff 0%, #d6d6d6 55%, #7c7c7c 100%)",
                      boxShadow:
                        "0 0 8px rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.5)",
                    }}
                  />
                )}
                {isGoal && (
                  <svg
                    viewBox="0 0 10 10"
                    className="w-3/4 h-3/4"
                    style={{
                      filter:
                        "drop-shadow(0 0 5px #ff3d6e) drop-shadow(0 1px 0 rgba(0,0,0,0.6))",
                    }}
                  >
                    <polygon
                      points="5,1 9,9 1,9"
                      fill="url(#goalGrad)"
                      stroke="#ff7088"
                      strokeWidth="0.4"
                    />
                    <defs>
                      <linearGradient id="goalGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff8aa3" />
                        <stop offset="55%" stopColor="#e0245e" />
                        <stop offset="100%" stopColor="#8b0e2c" />
                      </linearGradient>
                    </defs>
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* D-pad */}
      <div className="mt-4 grid grid-cols-3 gap-2 mx-auto" style={{ maxWidth: 180 }}>
        <div />
        <button
          disabled={disabled || module.solved}
          onClick={() => fire("up")}
          className="btn-3d aspect-square rounded-sm flex items-center justify-center text-bone"
          aria-label="Move up"
        >
          <ChevronUp size={20} strokeWidth={3} />
        </button>
        <div />
        <button
          disabled={disabled || module.solved}
          onClick={() => fire("left")}
          className="btn-3d aspect-square rounded-sm flex items-center justify-center text-bone"
          aria-label="Move left"
        >
          <ChevronLeft size={20} strokeWidth={3} />
        </button>
        <div className="aspect-square" />
        <button
          disabled={disabled || module.solved}
          onClick={() => fire("right")}
          className="btn-3d aspect-square rounded-sm flex items-center justify-center text-bone"
          aria-label="Move right"
        >
          <ChevronRight size={20} strokeWidth={3} />
        </button>
        <div />
        <button
          disabled={disabled || module.solved}
          onClick={() => fire("down")}
          className="btn-3d aspect-square rounded-sm flex items-center justify-center text-bone"
          aria-label="Move down"
        >
          <ChevronDown size={20} strokeWidth={3} />
        </button>
        <div />
      </div>
    </div>
  );
}
