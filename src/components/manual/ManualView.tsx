import { useEffect, useRef, useState } from "react";
import {
  generateManualPages,
  memoryRuleText,
  encodeMorse,
} from "../../lib/generator";
import type {
  ManualPage,
  SimonColor,
  MazeData,
  MemoryStageConfig,
  MorseEntry,
} from "../../lib/types";
import { MORSE_FREQS } from "../../lib/types";
import {
  MAZE_SIZE,
  MAZE_W_N,
  MAZE_W_E,
  MAZE_W_S,
  MAZE_W_W,
} from "../../lib/types";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { play } from "../../lib/sound";

interface ManualViewProps {
  seed: number;
}

// Phase machine: idle → exit (current page slides out) → enter (next page
// slides in) → idle. The two `side` fields are independent so we can fly the
// outgoing page off one side and bring the new page in from the other.
type Phase =
  | { kind: "idle" }
  | { kind: "exit"; side: "left" | "right"; targetIdx: number }
  | { kind: "enter"; side: "left" | "right" };

export function ManualView({ seed }: ManualViewProps) {
  const pages = generateManualPages(seed);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const page = pages[selectedIdx];
  const atFirst = selectedIdx === 0;
  const atLast = selectedIdx === pages.length - 1;
  const animating = phase.kind !== "idle";

  // Refs so click handlers always see the freshest values (react re-renders
  // are async; without these, a double-click can fire two flipTo's before the
  // first re-render commits, both reading `animating === false`).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;

  function flipTo(target: number) {
    if (phaseRef.current.kind !== "idle") return;
    const cur = selectedIdxRef.current;
    if (target === cur || target < 0 || target >= pages.length) return;
    const side: "left" | "right" = target > cur ? "left" : "right";
    play("pageTurn");
    setPhase({ kind: "exit", side, targetIdx: target });
  }

  function handleAnimationEnd() {
    if (phase.kind === "exit") {
      setSelectedIdx(phase.targetIdx);
      // After current goes off (say) left, new comes in from the right.
      setPhase({
        kind: "enter",
        side: phase.side === "left" ? "right" : "left",
      });
    } else if (phase.kind === "enter") {
      setPhase({ kind: "idle" });
    }
  }

  // Keyboard arrows
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") flipTo(selectedIdx + 1);
      else if (e.key === "ArrowLeft") flipTo(selectedIdx - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, animating]);

  const animClass =
    phase.kind === "exit" && phase.side === "left"
      ? "animate-page-exit-left"
      : phase.kind === "exit" && phase.side === "right"
      ? "animate-page-exit-right"
      : phase.kind === "enter" && phase.side === "left"
      ? "animate-page-enter-from-left"
      : phase.kind === "enter" && phase.side === "right"
      ? "animate-page-enter-from-right"
      : "";

  // Unified swipe (touch + mouse + pen) via pointer events. We only "take
  // over" the gesture once horizontal movement clearly dominates, otherwise
  // we let vertical scroll and text selection proceed normally.
  const pointerRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
    captured: boolean;
  } | null>(null);
  const SWIPE_THRESHOLD = 55;
  const TAKEOVER_THRESHOLD = 10;

  function handlePointerDown(e: React.PointerEvent) {
    // Only left mouse button counts; touch and pen always do.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerRef.current = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      captured: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const s = pointerRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (
      !s.captured &&
      Math.abs(dx) > TAKEOVER_THRESHOLD &&
      Math.abs(dx) > Math.abs(dy) * 1.2
    ) {
      s.captured = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture not supported — fall back to plain delta tracking */
      }
      // Clear any text selection that may have started on the way down.
      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const s = pointerRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    pointerRef.current = null;
    if (!s.captured) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) flipTo(selectedIdxRef.current + 1);
    else flipTo(selectedIdxRef.current - 1);
  }

  return (
    <div className="h-full flex flex-col tx-paper text-ink">
      {/* Classification banner */}
      <div className="flex-none flex items-center justify-between px-4 sm:px-6 py-2 bg-ink text-paper border-b-2 border-ink">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-mono">
          <BookOpen size={12} strokeWidth={2.5} />
          <span>Bomb Defusal · Field Manual</span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-mono opacity-70">
          <span>Issue 47</span>
          <span>·</span>
          <span>Restricted Distribution</span>
        </div>
      </div>

      {/* Top nav strip: discoverable affordance for swipe + a fallback for
          desktop users who can't swipe (keyboard arrows also work). */}
      <div className="flex-none flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-paper-dim/50 border-b border-ink/15 text-[10px] font-mono uppercase tracking-[0.25em] text-ink/60">
        <button
          onClick={() => flipTo(selectedIdx - 1)}
          disabled={atFirst || animating}
          aria-label="Previous page"
          className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors px-2 py-1"
        >
          <ChevronLeft size={14} strokeWidth={2.5} />
          <span className="hidden sm:inline">Prev</span>
        </button>
        <span className="flex items-center gap-2 opacity-80">
          <span>§{selectedIdx + 1} / {pages.length}</span>
          <span className="opacity-60 hidden sm:inline">·</span>
          <span className="opacity-60 hidden sm:inline">swipe ←→</span>
        </span>
        <button
          onClick={() => flipTo(selectedIdx + 1)}
          disabled={atLast || animating}
          aria-label="Next page"
          className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors px-2 py-1"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={14} strokeWidth={2.5} />
        </button>
      </div>

      {/* Book area — full-width scroll, swipe (touch or mouse drag) drives
          page changes. `touch-action: pan-y` lets vertical scroll work
          natively, we only steal horizontal-dominant gestures.
          The `paper-stack` wrapper draws the visible cut edges of the
          surrounding pages at the left/right, so the active sheet reads
          as one page of a larger block — mid-flip, the leaving sheet
          slides off those edges and exposes more of the stack. */}
      <div
        className={`flex-1 min-h-0 overflow-hidden relative paper-stack ${
          animating ? "is-flipping" : ""
        }`}
      >
        <div
          className="absolute inset-0 overflow-auto scrollbar-ink tx-paper-lines"
          style={{ touchAction: "pan-y" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pointerRef.current = null;
          }}
        >
          <main
            key={selectedIdx}
            onAnimationEnd={handleAnimationEnd}
            className={`min-h-full paper-sheet tx-paper py-5 sm:py-10 px-4 sm:px-10 mx-2 ${animClass}`}
          >
            <ManualPageView
              page={page}
              index={selectedIdx}
              total={pages.length}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

/* Single layout for all viewports.
   - Mobile-first sizes (compact padding, small ink labels above each cell).
   - As the container grows the cards expand proportionally; the same
   structure works on every breakpoint. */
function ResponsiveTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  // Use a CSS grid sized by content: first column auto (badges / numbers),
  // middle columns 1fr, last column auto. Falls back to even split if there
  // are only two columns.
  const cols = headers.length;
  const gridTemplate =
    cols === 1
      ? "1fr"
      : cols === 2
      ? "auto 1fr"
      : `auto repeat(${cols - 2}, minmax(0, 1fr)) auto`;
  return (
    <div className="border border-ink/30 manual-card bg-paper mb-3 overflow-hidden">
      {/* Header row */}
      <div
        className="grid bg-ink text-paper"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {headers.map((h, i) => (
          <div
            key={i}
            className="px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-mono font-bold border-r border-paper/15 last:border-r-0 whitespace-nowrap"
          >
            {h}
          </div>
        ))}
      </div>
      {/* Data rows */}
      <div className="divide-y divide-ink/15">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className={`grid items-start ${
              ri % 2 === 1 ? "bg-paper-stain/30" : "bg-paper"
            }`}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {row.map((cell, ci) => (
              <div
                key={ci}
                className="px-2.5 py-1.5 font-serif text-[13px] sm:text-sm leading-tight border-r border-ink/12 last:border-r-0 break-words"
              >
                {ci === 0 && cell.length <= 3 ? (
                  <span className="font-stencil text-base text-stamp tracking-wider">
                    {cell}
                  </span>
                ) : (
                  cell
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}


/* Simon substitution table — 6 cells laid out 2 columns × 3 rows.
   Each cell is one (vowel/no-vowel, strikes 0/1/2) sub-table that maps
   each flashed colour to the press colour. Manual page rotates per
   seed so this is the only place these cells are surfaced. */
const SIMON_LIST: SimonColor[] = ["red", "blue", "yellow", "green"];
const SIMON_SWATCH: Record<SimonColor, { bg: string; fg: string; label: string }> = {
  red:    { bg: "#c0312a", fg: "#fff",   label: "RED" },
  blue:   { bg: "#1d4ea0", fg: "#fff",   label: "BLUE" },
  yellow: { bg: "#e6b524", fg: "#3a2a00", label: "YELLOW" },
  green:  { bg: "#1f8c52", fg: "#fff",   label: "GREEN" },
};

function SimonSwatch({ color }: { color: SimonColor }) {
  const s = SIMON_SWATCH[color];
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 font-mono font-bold text-[11px] tracking-[0.18em] rounded-sm border border-ink/40"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function SimonTableBlock({
  tables,
}: {
  tables: Array<Record<SimonColor, SimonColor>>;
}) {
  /* tables[i] where i = strikes * 2 + (vowel ? 1 : 0). */
  const ROWS = [
    { strikes: 0, label: "0 STRIKES" },
    { strikes: 1, label: "1 STRIKE" },
    { strikes: 2, label: "2+ STRIKES" },
  ];
  const COLS: Array<{ vowel: boolean; label: string }> = [
    { vowel: false, label: "No vowel in serial" },
    { vowel: true, label: "Vowel in serial" },
  ];
  return (
    <div className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        <span>Simon · Substitution</span>
        <span>Flash → Press</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "auto 1fr 1fr" }}>
        {/* header row */}
        <div className="bg-ink/85 text-paper px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] border-b border-paper/15" />
        {COLS.map((c) => (
          <div
            key={c.label}
            className="bg-ink/85 text-paper px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] border-b border-paper/15 border-l border-paper/15"
          >
            {c.label}
          </div>
        ))}

        {ROWS.map((row, ri) =>
          [null, ...COLS].map((col, ci) => {
            const stripe = ri % 2 === 1 ? "bg-paper-stain/30" : "bg-paper";
            if (col === null) {
              return (
                <div
                  key={`${ri}-l`}
                  className={`${stripe} px-2 py-2 text-[10px] font-mono uppercase tracking-[0.2em] text-ink/70 border-t border-ink/15 self-center whitespace-nowrap`}
                >
                  {row.label}
                </div>
              );
            }
            const idx = row.strikes * 2 + (col.vowel ? 1 : 0);
            const cell = tables[idx];
            return (
              <div
                key={`${ri}-${ci}`}
                className={`${stripe} px-2 py-1.5 border-t border-ink/15 border-l border-ink/15`}
              >
                <div className="grid grid-cols-[auto_auto_auto] gap-x-1 gap-y-0.5 items-center justify-start">
                  {SIMON_LIST.map((flash) => (
                    <div key={flash} className="contents">
                      <SimonSwatch color={flash} />
                      <span className="font-mono text-ink/60 text-xs px-1">→</span>
                      <SimonSwatch color={cell[flash]} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* Render a single maze from the pool — walls drawn as ink lines, the
   two identification markers drawn as filled green dots. Player matches
   green dots to the bomb display. */
function MazeOne({ maze }: { maze: MazeData }) {
  const CELL = 22;
  const PAD = 2;
  const size = MAZE_SIZE * CELL + PAD * 2;
  const lines: React.ReactNode[] = [];

  // Outer border — always present.
  lines.push(
    <rect
      key="border"
      x={PAD}
      y={PAD}
      width={MAZE_SIZE * CELL}
      height={MAZE_SIZE * CELL}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  );

  // Internal walls. To avoid drawing each wall twice (cells share walls),
  // only render N (top) and W (left) walls — except for the outer edges
  // which the border already covers.
  for (let y = 0; y < MAZE_SIZE; y++) {
    for (let x = 0; x < MAZE_SIZE; x++) {
      const w = maze.walls[y * MAZE_SIZE + x];
      const x0 = PAD + x * CELL;
      const y0 = PAD + y * CELL;
      if (y > 0 && w & MAZE_W_N) {
        lines.push(
          <line
            key={`n-${x}-${y}`}
            x1={x0}
            y1={y0}
            x2={x0 + CELL}
            y2={y0}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
          />
        );
      }
      if (x > 0 && w & MAZE_W_W) {
        lines.push(
          <line
            key={`w-${x}-${y}`}
            x1={x0}
            y1={y0}
            x2={x0}
            y2={y0 + CELL}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
          />
        );
      }
    }
  }

  // Marker dots — drawn over the grid.
  const markers = maze.markers.map((m, i) => (
    <circle
      key={`mk-${i}`}
      cx={PAD + m.x * CELL + CELL / 2}
      cy={PAD + m.y * CELL + CELL / 2}
      r={CELL * 0.28}
      fill="var(--color-ledger, #0e6b3a)"
      stroke="#03331c"
      strokeWidth="0.6"
    />
  ));

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-auto block"
      style={{ color: "var(--color-ink)" }}
    >
      {lines}
      {markers}
    </svg>
  );
}

function MazeGridBlock({ pool }: { pool: MazeData[] }) {
  return (
    <div className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        <span>Maze Pool</span>
        <span>Match green markers</span>
      </div>
      <div className="grid grid-cols-3 gap-2 p-2">
        {pool.map((maze, i) => (
          <div
            key={i}
            className={`border border-ink/25 p-1.5 ${
              i % 2 === 1 ? "bg-paper-stain/30" : "bg-paper"
            }`}
          >
            <div className="text-[8px] font-mono uppercase tracking-[0.25em] text-ink/55 mb-1 px-1">
              §{i + 1}
            </div>
            <MazeOne maze={maze} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryStagesBlock({ stages }: { stages: MemoryStageConfig[] }) {
  return (
    <div className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        <span>Memory · Stages</span>
        <span>Apply rule, remember press</span>
      </div>
      <div className="divide-y divide-ink/15">
        {stages.map((stage, i) => (
          <div
            key={i}
            className={`px-3 py-2 ${
              i % 2 === 1 ? "bg-paper-stain/30" : "bg-paper"
            }`}
          >
            <div className="flex items-baseline gap-3 mb-1">
              <span className="font-stencil text-stamp text-base tracking-[0.18em]">
                STAGE {i + 1}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/55">
                Display: <span className="font-bold text-ink">{stage.display}</span>
              </span>
            </div>
            <p className="font-serif text-[14px] sm:text-[15px] leading-relaxed text-ink/85">
              {memoryRuleText(stage.rule)}.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Morse table — for each word in the pool show its morse encoding and
   the frequency to transmit on. Pool is pre-sorted alphabetically. */
function MorseTableBlock({ pool }: { pool: MorseEntry[] }) {
  return (
    <div className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        <span>Morse · Word ↔ Frequency</span>
        <span>MHz</span>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] divide-y divide-ink/15">
        {pool.map((entry, i) => {
          const stripe = i % 2 === 1 ? "bg-paper-stain/30" : "bg-paper";
          const morse = encodeMorse(entry.word).join("  ");
          return (
            <div key={i} className="contents">
              <div
                className={`${stripe} px-3 py-1.5 font-stencil text-lg tracking-[0.15em] text-ink border-t border-ink/15`}
              >
                {entry.word}
              </div>
              <div
                className={`${stripe} px-3 py-1.5 font-mono text-xs leading-tight text-ink/75 border-t border-ink/15 self-center break-all`}
              >
                {morse}
              </div>
              <div
                className={`${stripe} px-3 py-1.5 font-mono font-bold text-ink border-t border-ink/15 self-center whitespace-nowrap`}
              >
                {MORSE_FREQS[entry.freqIndex].toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Password manual: shows the 5 letter pools at the top and the full
   dictionary below as a flowing word-grid. The Expert spots which
   words can be assembled from the available letters. */
function PasswordDictBlock({
  words,
  columns,
}: {
  words: string[];
  columns: string[][];
}) {
  return (
    <div className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        <span>Password · Letter Pools</span>
      </div>
      <div className="grid grid-cols-5 gap-px bg-ink/15 border-b border-ink/15">
        {columns.map((col, i) => (
          <div key={i} className="bg-paper px-2 py-2">
            <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-ink/55 mb-1 text-center">
              Col {i + 1}
            </div>
            <div className="flex flex-col items-center gap-0.5">
              {col.map((ch, j) => (
                <div
                  key={`${i}-${j}`}
                  className="font-stencil text-lg leading-tight text-ink"
                >
                  {ch}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
        Dictionary
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-1 p-3 bg-paper">
        {words.map((w) => (
          <span
            key={w}
            className="font-mono text-[12px] tracking-[0.1em] text-ink/85"
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

function GlyphSvg({ paths }: { paths: string[] }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="7"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

function ManualPageView({ page, index, total }: { page: ManualPage; index: number; total: number }) {
  return (
    <article className="max-w-3xl reveal">
      {/* Page header */}
      <div className="flex items-end justify-between mb-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/50">
          Section §{index + 1}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/40">
          Page {index + 1} of {total}
        </div>
      </div>

      <h1 className="font-serif text-2xl sm:text-4xl font-bold tracking-tight mt-1 mb-4 sm:mb-5 pb-3 border-b-2 border-ink">
        {page.title}
      </h1>

      {page.sections.map((section, si) => (
        <section key={si} className="mb-6 sm:mb-7">
          <h2 className="font-serif text-base sm:text-lg font-bold mb-3 text-ink">
            {section.heading}
          </h2>

          {section.content.map((block, bi) => {
            if (block.type === "paragraph") {
              return (
                <p
                  key={bi}
                  className="font-serif text-[14px] sm:text-[15px] leading-relaxed mb-3 text-ink/85"
                >
                  {block.text}
                </p>
              );
            }

            if (block.type === "table") {
              return (
                <ResponsiveTable
                  key={bi}
                  headers={block.headers}
                  rows={block.rows}
                />
              );
            }

            if (block.type === "rule") {
              return (
                <div
                  key={bi}
                  className="mb-2 p-3 border-l-4 border-stamp/60 bg-paper-stain/30"
                >
                  <div className="flex gap-2 items-start mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/55 mt-0.5 shrink-0">
                      IF
                    </span>
                    <span className="text-sm flex-1 font-serif">
                      {block.condition}
                    </span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/55 mt-0.5 shrink-0">
                      THEN
                    </span>
                    <span className="text-sm font-bold flex-1 font-serif">
                      {block.action}
                    </span>
                  </div>
                </div>
              );
            }

            if (block.type === 'simonTable') {
              return <SimonTableBlock key={bi} tables={block.tables} />;
            }

            if (block.type === 'mazeGrid') {
              return <MazeGridBlock key={bi} pool={block.pool} />;
            }

            if (block.type === 'memoryStages') {
              return <MemoryStagesBlock key={bi} stages={block.stages} />;
            }

            if (block.type === 'morseTable') {
              return <MorseTableBlock key={bi} pool={block.pool} />;
            }

            if (block.type === 'passwordDict') {
              return (
                <PasswordDictBlock
                  key={bi}
                  words={block.words}
                  columns={block.columns}
                />
              );
            }

            if (block.type === 'symbolColumns') {
              return (
                <div
                  key={bi}
                  className="border-2 border-ink/40 manual-card bg-paper overflow-hidden mb-3 w-full"
                >
                  {/* Header band */}
                  <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-ink text-paper text-[10px] font-mono uppercase tracking-[0.3em]">
                    <span>Symbol Reference</span>
                    <span className="flex items-center gap-1.5">
                      Press Order
                      <span className="font-stencil text-base leading-none">↓</span>
                    </span>
                  </div>

                  {/* Columns share the full available width and the glyphs
                     scale with their column so everything fits at any size. */}
                  <div className="flex w-full">
                    {block.columns.map((col, ci) => (
                      <div
                        key={ci}
                        className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 px-0.5 py-2 ${
                          ci < block.columns.length - 1
                            ? "border-r border-ink/15"
                            : ""
                        } ${ci % 2 === 1 ? "bg-paper-stain/25" : ""}`}
                      >
                        {col.map((sym) => (
                          <div
                            key={sym.id}
                            className="w-full max-w-14 aspect-square text-ink"
                          >
                            <GlyphSvg paths={sym.paths} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return null;
          })}
        </section>
      ))}

      {/* Footer stamp */}
      <div className="mt-8 sm:mt-10 flex items-end justify-between">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/40">
          Acme Defusal Division · M-7
        </div>
        <div className="stamp text-stamp text-[10px] stamp-sm">
          AUTHORIZED
        </div>
      </div>
    </article>
  );
}
