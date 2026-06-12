import { useEffect } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Module, MazeModuleConfig, Direction, MazeCell } from "../../lib/types";
import {
  MAZE_SIZE,
  MAZE_W_N,
  MAZE_W_E,
  MAZE_W_S,
  MAZE_W_W,
} from "../../lib/types";
import { play } from "../../lib/sound";

interface MazeModuleProps {
  module: Module;
  disabled: boolean;
  onMove: (direction: Direction) => void;
}

/* The bomb-side maze: one SVG drawing the defuser's share of walls
   (~33%), the 2 green markers, the trail of visited cells, the goal
   triangle, and the current-position circle. Layering everything in one
   coordinate system means a cell containing several items (e.g. the
   defuser standing on a marker, or the current position equal to a
   trail cell) stays perfectly centred — no flexbox stacking weirdness. */
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

      <div className="mx-auto bg-black/65 border border-steel/40 p-2 rounded-sm">
        <MazeBoard
          walls={active.walls}
          defuserWalls={active.defuserWalls}
          markers={active.markers}
          current={currentPos}
          goal={config.goal}
          trail={trail}
        />
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

function MazeBoard({
  walls,
  defuserWalls,
  markers,
  current,
  goal,
  trail,
}: {
  walls: number[];
  defuserWalls: number[];
  markers: readonly MazeCell[];
  current: MazeCell;
  goal: MazeCell;
  trail: readonly MazeCell[];
}) {
  const CELL = 30;
  const PAD = 4;
  const size = MAZE_SIZE * CELL + PAD * 2;
  const cellCenter = (c: MazeCell) => ({
    cx: PAD + c.x * CELL + CELL / 2,
    cy: PAD + c.y * CELL + CELL / 2,
  });

  /* Build the wall lines once: dim every cell border as a faint grid
     hint, then over-draw bright lines for the walls the defuser owns.
     Each shared edge appears in two cells' bitmasks but we render only
     the N and W walls per cell (S/E come from the neighbour) to dedupe. */
  const gridLines: React.ReactNode[] = [];
  const wallLines: React.ReactNode[] = [];
  for (let y = 0; y < MAZE_SIZE; y++) {
    for (let x = 0; x < MAZE_SIZE; x++) {
      const idx = y * MAZE_SIZE + x;
      const w = walls[idx];
      const d = defuserWalls[idx];
      const x0 = PAD + x * CELL;
      const y0 = PAD + y * CELL;
      const x1 = x0 + CELL;
      const y1 = y0 + CELL;

      /* faint cell grid (every cell side, even where no wall) */
      if (y === 0) {
        gridLines.push(<line key={`g-t-${x}`} x1={x0} y1={y0} x2={x1} y2={y0} stroke="#1a2333" strokeWidth="1" />);
      }
      if (x === 0) {
        gridLines.push(<line key={`g-l-${y}`} x1={x0} y1={y0} x2={x0} y2={y1} stroke="#1a2333" strokeWidth="1" />);
      }
      gridLines.push(<line key={`g-b-${x}-${y}`} x1={x0} y1={y1} x2={x1} y2={y1} stroke="#1a2333" strokeWidth="1" />);
      gridLines.push(<line key={`g-r-${x}-${y}`} x1={x1} y1={y0} x2={x1} y2={y1} stroke="#1a2333" strokeWidth="1" />);

      /* Defuser-visible walls — only the actually-present ones. */
      if (w & d & MAZE_W_N) {
        wallLines.push(
          <line key={`d-n-${x}-${y}`} x1={x0} y1={y0} x2={x1} y2={y0} stroke="#f5f1e8" strokeWidth="2.4" strokeLinecap="square" />
        );
      }
      if (w & d & MAZE_W_W) {
        wallLines.push(
          <line key={`d-w-${x}-${y}`} x1={x0} y1={y0} x2={x0} y2={y1} stroke="#f5f1e8" strokeWidth="2.4" strokeLinecap="square" />
        );
      }
      /* Outer south/east borders need their own draw — no neighbour
         "north/west" rendering will cover them. */
      if (y === MAZE_SIZE - 1 && w & d & MAZE_W_S) {
        wallLines.push(
          <line key={`d-s-${x}-${y}`} x1={x0} y1={y1} x2={x1} y2={y1} stroke="#f5f1e8" strokeWidth="2.4" strokeLinecap="square" />
        );
      }
      if (x === MAZE_SIZE - 1 && w & d & MAZE_W_E) {
        wallLines.push(
          <line key={`d-e-${x}-${y}`} x1={x1} y1={y0} x2={x1} y2={y1} stroke="#f5f1e8" strokeWidth="2.4" strokeLinecap="square" />
        );
      }
    }
  }

  /* Layering order, bottom → top:
     1. dim cell grid
     2. trail dots
     3. markers
     4. defuser walls (so walls overlay markers when they coincide)
     5. goal triangle
     6. current position */
  const markerEls = markers.map((m, i) => {
    const { cx, cy } = cellCenter(m);
    return (
      <circle
        key={`mk-${i}`}
        cx={cx}
        cy={cy}
        r={CELL * 0.32}
        fill="url(#mkGrad)"
        stroke="#0a4626"
        strokeWidth="0.6"
      />
    );
  });

  const trailEls = trail.map((c, i) => {
    if (c.x === current.x && c.y === current.y) return null;
    const { cx, cy } = cellCenter(c);
    return (
      <circle
        key={`tr-${i}`}
        cx={cx}
        cy={cy}
        r={CELL * 0.12}
        fill="#00f5a0"
        opacity={0.45}
      />
    );
  });

  const goalCenter = cellCenter(goal);
  const goalR = CELL * 0.32;
  const goalEl = (
    <polygon
      points={[
        `${goalCenter.cx},${goalCenter.cy - goalR}`,
        `${goalCenter.cx + goalR * 0.9},${goalCenter.cy + goalR * 0.7}`,
        `${goalCenter.cx - goalR * 0.9},${goalCenter.cy + goalR * 0.7}`,
      ].join(" ")}
      fill="url(#goalGrad)"
      stroke="#ff7088"
      strokeWidth="0.8"
      filter="url(#goalGlow)"
    />
  );

  const currentCenter = cellCenter(current);
  const currentEl = (
    <circle
      cx={currentCenter.cx}
      cy={currentCenter.cy}
      r={CELL * 0.3}
      fill="url(#curGrad)"
      stroke="#ffffff"
      strokeWidth="0.6"
      filter="url(#curGlow)"
    />
  );

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-auto block"
      style={{ background: "#050a14" }}
    >
      <defs>
        <radialGradient id="mkGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6dffaf" />
          <stop offset="60%" stopColor="#14b86b" />
          <stop offset="100%" stopColor="#094a2a" />
        </radialGradient>
        <linearGradient id="goalGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8aa3" />
          <stop offset="55%" stopColor="#e0245e" />
          <stop offset="100%" stopColor="#8b0e2c" />
        </linearGradient>
        <radialGradient id="curGrad" cx="32%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#d6d6d6" />
          <stop offset="100%" stopColor="#7c7c7c" />
        </radialGradient>
        <filter id="curGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="goalGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {gridLines}
      {trailEls}
      {markerEls}
      {wallLines}
      {goalEl}
      {currentEl}
    </svg>
  );
}
