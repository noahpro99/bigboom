import { useEffect, useRef, useState } from "react";
import {
  generateManualPages,
  memoryRuleText,
} from "../../lib/generator";
import type {
  ManualPage,
  SimonColor,
  MazeData,
  MemoryStageConfig,
  MorseEntry,
  ModuleType,
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
import { ProfileButton } from "../ProfileButton";

interface ManualViewProps {
  seed: number;
  /* Which module types the bomb actually has. The manual filters its
     pages to match so the Expert isn't reading rules for modules that
     aren't on the bomb. Duplicate types collapse to a single page. */
  moduleTypes?: ModuleType[];
}

// Phase machine: idle → exit (current page slides out) → enter (next page
// slides in) → idle. The two `side` fields are independent so we can fly the
// outgoing page off one side and bring the new page in from the other.
type Phase =
  | { kind: "idle" }
  | { kind: "exit"; side: "left" | "right"; targetIdx: number }
  | { kind: "enter"; side: "left" | "right" };

export function ManualView({ seed, moduleTypes }: ManualViewProps) {
  const pages = generateManualPages(seed, moduleTypes);
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

  /* Pending-flip queue. queueFlipBy() just adds a signed count to the
     net direction the reader wants to go; if the animation is already
     mid-flip we don't drop the input. After each animation lands back
     in idle, processNextFlip() pops one off the queue and animates the
     next page. Net result: rapid double-swipe travels two pages, plays
     two sounds, takes two animation lengths — but no input is lost. */
  const pendingDeltaRef = useRef(0);

  function processNextFlip() {
    if (pendingDeltaRef.current === 0) return;
    const dir = Math.sign(pendingDeltaRef.current);
    const target = selectedIdxRef.current + dir;
    if (target < 0 || target >= pages.length) {
      /* Hit the edge of the book — collapse the queue so further
         swipes in the same direction don't pile up. */
      pendingDeltaRef.current = 0;
      return;
    }
    pendingDeltaRef.current -= dir;
    play("pageTurn");
    setPhase({
      kind: "exit",
      side: dir > 0 ? "left" : "right",
      targetIdx: target,
    });
  }

  function queueFlipBy(direction: -1 | 1) {
    pendingDeltaRef.current += direction;
    if (phaseRef.current.kind === "idle") processNextFlip();
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

  /* Whenever we land in idle, drain one queued flip. Driven by the
     phase state change so it runs after React has committed the
     reset. */
  useEffect(() => {
    if (phase.kind === "idle") processNextFlip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Keyboard arrows
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") queueFlipBy(1);
      else if (e.key === "ArrowLeft") queueFlipBy(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    /* Ignore pointerdowns that land on an interactive control. The
       Settings modal portals to document.body but React still bubbles
       its synthetic events back through the component tree (the
       ProfileButton trigger lives inside the manual header) — so a
       drag on a settings slider would otherwise be hijacked here.
       Buttons inside the manual itself (prev/next/profile) also pass
       through this filter, since their onClick handlers don't depend
       on the swipe tracker. `data-no-swipe` is an escape hatch any
       sub-tree can use without depending on element type. */
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest(
        "input, button, select, textarea, a, [role='button'], [role='slider'], [data-no-swipe]"
      )
    ) {
      return;
    }
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
    queueFlipBy(dx < 0 ? 1 : -1);
  }

  return (
    /* One piece of paper — the manual area IS the sheet. The shadow on
       the sheet gives it elevation against the dark chassis; the
       scrollable area inside is transparent so the paper texture is
       continuous from edge to edge. */
    <div
      className={`h-full relative paper-stack paper-sheet manual-paper tx-paper text-ink overflow-hidden ${
        animating ? "is-flipping" : ""
      }`}
    >
      <div
        /* cursor-grab in the resting state, cursor-grabbing while a
           mouse button is actually pressed — gives the "I can swipe
           this" affordance without needing any visible UI. Interactive
           children (buttons, inputs) override to their own cursor via
           the regular CSS cascade. */
        className="absolute inset-0 overflow-auto scrollbar-ink tx-paper-lines cursor-grab active:cursor-grabbing"
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
          className={`${
            page.kind === "cover" ? "h-full" : "min-h-full"
          } ${animClass}`}
        >
          {page.kind === "cover" ? (
            /* The cover is its own beast: no running header, no nav,
               no body padding — just a full-bleed dark book-cloth
               with the title embossed in gilt and a sliver of the
               first paper page peeking out from the right edge. */
            <CoverPage seed={seed} onSwipeNext={() => queueFlipBy(1)} />
          ) : (
            <>
              {/* Running header — printed on the page, no background
                 change. Profile/settings chip lives at the far right;
                 styled in the same paper-ink tone so it reads as a
                 printed icon. Constrained to the same measure as the
                 body so its content sits over the printed area. */}
              <div className="px-4 sm:px-10 pt-3">
                <header className="max-w-3xl mx-auto flex items-center justify-between gap-3 pb-2 font-serif italic text-[11px] text-ink/65">
                  <span className="flex items-center gap-1.5">
                    <BookOpen size={11} strokeWidth={2} className="opacity-70" />
                    Bomb Defusal · Field Manual
                  </span>
                  <span className="hidden md:inline">
                    Issue 47 — Restricted Distribution
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden sm:inline">§{selectedIdx + 1} of {pages.length}</span>
                    <ProfileButton variant="light" showLabel={false} />
                  </span>
                </header>
                <hr className="ink-rule-hair max-w-3xl mx-auto" />
              </div>

              {/* Top nav — printed tap targets right under the running
                  header. */}
              <div className="px-4 sm:px-10 pt-2 pb-1">
                <nav className="max-w-3xl mx-auto">
                  <div className="flex items-baseline justify-between font-serif italic text-[12px] text-ink/70">
                    <button
                      onClick={() => queueFlipBy(-1)}
                      disabled={atFirst}
                      aria-label="Previous page"
                      className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors"
                    >
                      <ChevronLeft size={13} strokeWidth={2.2} />
                      <span>prev</span>
                    </button>
                    <span className="text-ink/50 hidden sm:inline">swipe ←→</span>
                    <button
                      onClick={() => queueFlipBy(1)}
                      disabled={atLast}
                      aria-label="Next page"
                      className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors"
                    >
                      <span>next</span>
                      <ChevronRight size={13} strokeWidth={2.2} />
                    </button>
                  </div>
                  <hr className="ink-rule-hair mt-2" />
                </nav>
              </div>

              {/* Body — paper extends full width (so the page-flip
                 animation slides the whole sheet), but the printed
                 content stays centered with a comfortable measure
                 (~max-w-3xl) so wide screens don't read like a banner. */}
              <div className="py-4 sm:py-6 px-4 sm:px-10">
                <div className="max-w-3xl mx-auto">
                  <ManualPageView
                    page={page}
                    pages={pages}
                    index={selectedIdx}
                    total={pages.length}
                    seed={seed}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* Plain printed table — real <table> for honest alignment. No card,
   no background, no inverted header bar. The header is just bold serif
   text under a thin ink rule, and rows are separated by hairlines, the
   way a real manual prints tables. */
function ResponsiveTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <table className="w-full font-serif text-[14px] sm:text-[15px] mb-4 border-collapse ink-text">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              className="text-left align-bottom font-bold text-[11px] uppercase tracking-[0.18em] pb-1 px-2 first:pl-0 last:pr-0 border-b-[1.2px] border-ink/85 ink-text-bold"
              style={{ width: i === 0 ? "auto" : undefined }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-b border-ink/20 last:border-b-0">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className="align-top py-1.5 px-2 first:pl-0 last:pr-0 leading-snug"
              >
                {ci === 0 && cell.length <= 3 ? (
                  <span className="font-stencil text-[18px] text-stamp tracking-wider">
                    {cell}
                  </span>
                ) : (
                  cell
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* Simon substitution table — printed as a real lookup grid.
   Rows are the flashed colour, columns are the (vowel × strikes)
   state, and each cell is the colour to press. Aligned via <table>
   so columns share a single width definition. */
const SIMON_LIST: SimonColor[] = ["red", "blue", "yellow", "green"];
const SIMON_INK: Record<SimonColor, string> = {
  red:    "#a8201a",
  blue:   "#1d3f8e",
  yellow: "#a17418",
  green:  "#176f3f",
};
const SIMON_LABEL: Record<SimonColor, string> = {
  red: "RED", blue: "BLUE", yellow: "YELLOW", green: "GREEN",
};

/* Colour-named text — the colour itself becomes the typographic cue
   instead of using a paint-chip swatch (which read as plastic, not
   ink). A small filled square sits in front to reinforce the colour. */
function SimonColorText({
  color,
  bold = false,
}: {
  color: SimonColor;
  bold?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      style={{ color: SIMON_INK[color] }}
    >
      <span
        aria-hidden
        className="inline-block w-2 h-2"
        style={{
          background: SIMON_INK[color],
          boxShadow: "0 0 0 0.6px rgba(60,40,15,0.55)",
        }}
      />
      <span
        className={`font-serif tracking-wide ${bold ? "font-bold" : ""}`}
        style={{
          textShadow:
            "0 0 0.3px rgba(60,40,15,0.45), 0 0.4px 0 rgba(40,25,10,0.25)",
        }}
      >
        {SIMON_LABEL[color]}
      </span>
    </span>
  );
}

function SimonTableBlock({
  tables,
}: {
  tables: Array<Record<SimonColor, SimonColor>>;
}) {
  /* tables[i] where i = strikes * 2 + (vowel ? 1 : 0). */
  const COLS: Array<{ vowel: boolean; strikes: number; head1: string; head2: string }> = [
    { vowel: false, strikes: 0, head1: "No vowel",   head2: "0 strikes" },
    { vowel: false, strikes: 1, head1: "No vowel",   head2: "1 strike"  },
    { vowel: false, strikes: 2, head1: "No vowel",   head2: "2+ strikes"},
    { vowel: true,  strikes: 0, head1: "Vowel",      head2: "0 strikes" },
    { vowel: true,  strikes: 1, head1: "Vowel",      head2: "1 strike"  },
    { vowel: true,  strikes: 2, head1: "Vowel",      head2: "2+ strikes"},
  ];
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-serif italic text-[12px] tracking-wide text-ink/75">
          If the bomb flashes the colour at left, press the colour shown
          under your serial / strikes column.
        </span>
      </div>
      <table className="w-full border-collapse font-serif text-[13px] sm:text-[14px] ink-text">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="text-left align-bottom font-bold text-[10px] uppercase tracking-[0.18em] pb-1 pr-2 border-b-[1.2px] border-ink/85 ink-text-bold whitespace-nowrap"
            >
              Flash
            </th>
            {COLS.map((c, i) => (
              <th
                key={i}
                className="text-center align-bottom font-bold text-[10px] uppercase tracking-[0.18em] px-1.5 pb-0.5 ink-text-bold"
                style={{
                  borderLeft: i === 3 ? "1.2px solid rgba(10,20,41,0.85)" : undefined,
                }}
              >
                {c.head1}
              </th>
            ))}
          </tr>
          <tr>
            {COLS.map((c, i) => (
              <th
                key={i}
                className="text-center align-bottom font-mono font-medium text-[10px] tracking-[0.12em] px-1.5 pb-1 border-b-[1.2px] border-ink/85 text-ink/80"
                style={{
                  borderLeft: i === 3 ? "1.2px solid rgba(10,20,41,0.85)" : undefined,
                }}
              >
                {c.head2}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIMON_LIST.map((flash) => (
            <tr
              key={flash}
              className="border-b border-ink/20 last:border-b-0"
            >
              <td className="align-middle pr-2 py-1.5">
                <SimonColorText color={flash} bold />
              </td>
              {COLS.map((c, i) => {
                const idx = c.strikes * 2 + (c.vowel ? 1 : 0);
                const press = tables[idx][flash];
                return (
                  <td
                    key={i}
                    className="align-middle text-center px-1.5 py-1.5"
                    style={{
                      borderLeft:
                        i === 3 ? "1.2px solid rgba(10,20,41,0.85)" : undefined,
                    }}
                  >
                    <SimonColorText color={press} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Render a single maze from the pool — only the EXPERT'S share of walls
   (the complement of the defuser's mask). The defuser sees the rest on
   the bomb; the two players coordinate to reconstruct the full maze.
   Markers are always drawn on both sides (they're how the maze is
   identified, not part of the wall puzzle). */
function MazeOne({ maze }: { maze: MazeData }) {
  const CELL = 22;
  const PAD = 2;
  const size = MAZE_SIZE * CELL + PAD * 2;
  const lines: React.ReactNode[] = [];

  /* Faint cell grid — every cell border in ink/15 so the player can
     read the maze as a 6×6 board even where neither side owns the wall.
     Drawn first so wall ink overdraws it. */
  for (let i = 0; i <= MAZE_SIZE; i++) {
    const off = PAD + i * CELL;
    lines.push(
      <line key={`g-h-${i}`} x1={PAD} y1={off} x2={PAD + MAZE_SIZE * CELL} y2={off} stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.6" />
    );
    lines.push(
      <line key={`g-v-${i}`} x1={off} y1={PAD} x2={off} y2={PAD + MAZE_SIZE * CELL} stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.6" />
    );
  }

  for (let y = 0; y < MAZE_SIZE; y++) {
    for (let x = 0; x < MAZE_SIZE; x++) {
      const idx = y * MAZE_SIZE + x;
      const w = maze.walls[idx];
      const d = maze.defuserWalls[idx];
      /* Expert sees present walls NOT in the defuser's mask. */
      const expert = w & ~d;
      const x0 = PAD + x * CELL;
      const y0 = PAD + y * CELL;
      const x1 = x0 + CELL;
      const y1 = y0 + CELL;

      if (expert & MAZE_W_N) {
        lines.push(
          <line key={`n-${x}-${y}`} x1={x0} y1={y0} x2={x1} y2={y0} stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        );
      }
      if (expert & MAZE_W_W) {
        lines.push(
          <line key={`w-${x}-${y}`} x1={x0} y1={y0} x2={x0} y2={y1} stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        );
      }
      if (y === MAZE_SIZE - 1 && expert & MAZE_W_S) {
        lines.push(
          <line key={`s-${x}-${y}`} x1={x0} y1={y1} x2={x1} y2={y1} stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        );
      }
      if (x === MAZE_SIZE - 1 && expert & MAZE_W_E) {
        lines.push(
          <line key={`e-${x}-${y}`} x1={x1} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        );
      }
    }
  }

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
    <figure className="mb-5">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        {pool.map((maze, i) => (
          <div key={i} className="flex flex-col items-center">
            <MazeOne maze={maze} />
            <figcaption className="mt-1 font-serif italic text-[11px] text-ink/65">
              fig. {i + 1}
            </figcaption>
          </div>
        ))}
      </div>
    </figure>
  );
}

function MemoryStagesBlock({ stages }: { stages: MemoryStageConfig[] }) {
  return (
    <div className="mb-5">
      {stages.map((stage, i) => (
        <div key={i} className="mb-4">
          <p className="font-stencil text-stamp text-base tracking-[0.15em] mb-1">
            Stage {i + 1}
          </p>
          <table className="w-full border-collapse font-serif text-[13px] sm:text-[14px] ink-text">
            <thead>
              <tr>
                <th className="text-left font-bold text-[10px] uppercase tracking-[0.18em] pb-1 pr-3 border-b-[1.2px] border-ink/85 ink-text-bold w-[5rem] whitespace-nowrap">
                  Display
                </th>
                <th className="text-left font-bold text-[10px] uppercase tracking-[0.18em] pb-1 pl-1 border-b-[1.2px] border-ink/85 ink-text-bold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {stage.rulesByDisplay.map((rule, d) => (
                <tr
                  key={d}
                  className="border-b border-ink/20 last:border-b-0"
                >
                  <td className="align-top py-1 pr-3 font-stencil text-stamp text-base">
                    {d + 1}
                  </td>
                  <td className="align-top py-1 pl-1 leading-snug">
                    {memoryRuleText(rule)}.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* Morse alphabet — A-Z printed as a compact reference table the Expert
   decodes the flashing/audible word against. Static, no per-bomb
   data. */
const MORSE_ALPHA: Array<[string, string]> = [
  ["A", ".-"],   ["B", "-..."], ["C", "-.-."], ["D", "-.."],
  ["E", "."],    ["F", "..-."], ["G", "--."],  ["H", "...."],
  ["I", ".."],   ["J", ".---"], ["K", "-.-"],  ["L", ".-.."],
  ["M", "--"],   ["N", "-."],   ["O", "---"],  ["P", ".--."],
  ["Q", "--.-"], ["R", ".-."],  ["S", "..."],  ["T", "-"],
  ["U", "..-"],  ["V", "...-"], ["W", ".--"],  ["X", "-..-"],
  ["Y", "-.--"], ["Z", "--.."],
];

function MorseAlphabetBlock() {
  return (
    <div className="mb-5">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-1 font-serif text-[13px] ink-text">
        {MORSE_ALPHA.map(([ch, code]) => (
          <div
            key={ch}
            className="flex items-baseline gap-2 leading-snug"
          >
            <span className="font-bold ink-text-bold w-3">{ch}</span>
            <span className="font-mono text-ink/85 tracking-wide">{code}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Word ↔ response frequency. Manual no longer shows the per-word morse
   encoding (Expert decodes via the alphabet table above), just the word
   and its MHz response. */
function MorseTableBlock({ pool }: { pool: MorseEntry[] }) {
  return (
    <div className="mb-5 columns-1 sm:columns-2 gap-x-6">
      {pool.map((entry) => (
        <div
          key={entry.word}
          className="font-serif text-[14px] leading-snug mb-1.5 break-inside-avoid flex items-baseline gap-2"
        >
          <span className="font-bold ink-text-bold tracking-wide">
            {entry.word}
          </span>
          <span className="ink-leader" aria-hidden />
          <span className="font-mono font-bold text-ink/90 whitespace-nowrap">
            {MORSE_FREQS[entry.freqIndex].toFixed(3)} MHz
          </span>
        </div>
      ))}
    </div>
  );
}

/* Password candidate list — the expert sees only the words, never the
   letter pools (which live on the defuser's dials). Reading each
   candidate aloud and confirming letter-by-letter is the point: it
   forces back-and-forth instead of letting the expert solve in their
   head. */
function PasswordDictBlock({ words }: { words: string[] }) {
  return (
    <div className="mb-5">
      <div className="font-serif italic text-[12px] text-ink/65 mb-1">
        Try each in turn — at least one will fit the defuser's dials.
      </div>
      <ul className="font-stencil text-[20px] tracking-[0.15em] ink-text-bold leading-relaxed pl-1 columns-1 sm:columns-2 gap-x-6">
        {words.map((w) => (
          <li key={w} className="flex items-baseline gap-2 break-inside-avoid">
            <span className="text-stamp text-base">▸</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
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

/* Tiny deterministic-noise helpers — derive a couple of "bibliographic"
   codes from the bomb seed so each manual cover has its own catalog
   number / classification suffix without being random across hydration. */
function seedAlphaCode(seed: number, length: number): string {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let n = (seed >>> 0) ^ 0xa5a5a5a5;
  let out = "";
  for (let i = 0; i < length; i++) {
    out += LETTERS[n % LETTERS.length];
    n = Math.floor(n / 23) ^ 0x5bd1e995;
  }
  return out;
}
function seedDigits(seed: number, length: number): string {
  let n = (seed >>> 0) ^ 0x12345678;
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String(n % 10);
    n = Math.floor(n / 7) ^ 0xa3b1c9d7;
  }
  return out;
}

/* --- Cover page ---
   Stapled field-manual booklet, same dimensions as the interior pages.
   Manila card stock with flat-printed ink (not foil), bound by a
   stitched seam down the left edge that carries three visible
   staples. */
function CoverPage({
  seed,
  onSwipeNext,
}: {
  seed: number;
  onSwipeNext: () => void;
}) {
  const catalog = `${seedAlphaCode(seed, 2)}-${seedDigits(seed, 4)}`;
  return (
    <div
      className="tx-cover relative h-full w-full flex select-none cursor-pointer"
      onClick={onSwipeNext}
    >
      {/* Left seam — staples + crease. Same position as where the
         interior pages would meet the binding. */}
      <div className="booklet-seam flex-none">
        <span className="booklet-staple" aria-hidden />
      </div>

      <div className="flex-1 flex flex-col items-center justify-between text-center px-6 py-10 sm:py-14 max-w-md mx-auto w-full">
        {/* Tiny imprint at the top — printer's mark style */}
        <div className="text-[9px] font-mono uppercase tracking-[0.35em] cover-ink opacity-65">
          Acme Defusal Division — Issue 47
        </div>

        {/* Title block — main ink-stamped lettering, flat and direct */}
        <div className="flex flex-col items-center gap-3">
          <h1
            className="font-stencil cover-ink text-6xl sm:text-7xl leading-[0.85] tracking-[0.03em]"
            style={{ letterSpacing: "0.02em" }}
          >
            BOMB
            <br />
            DEFUSAL
          </h1>
          <div className="text-[11px] font-mono uppercase tracking-[0.35em] cover-ink opacity-80">
            — Field Manual · M-7 —
          </div>
        </div>

        {/* Classification rubber-stamp, rotated slightly like a real
           inked stamp pressed onto the card */}
        <div className="my-2">
          <div
            className="inline-flex flex-col items-center px-4 py-2 border-2"
            style={{
              borderColor: "#7c1d1a",
              color: "#7c1d1a",
              transform: "rotate(-3deg)",
              fontFamily: "var(--font-stencil)",
              letterSpacing: "0.18em",
              opacity: 0.82,
              boxShadow: "inset 0 0 0 1px rgba(124, 29, 26, 0.18)",
            }}
          >
            <span className="text-[15px] font-bold">CLASSIFIED</span>
            <span className="text-[9px] tracking-[0.3em] mt-0.5">
              SECTOR · 7
            </span>
          </div>
        </div>

        {/* Swipe instruction */}
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.3em] cover-ink opacity-80 animate-cover-nudge">
          <span>swipe to open</span>
          <ChevronRight size={14} strokeWidth={2.5} />
        </div>

        {/* Catalog code at the bottom edge */}
        <div className="text-[9px] font-mono uppercase tracking-[0.3em] cover-ink opacity-65">
          No. {catalog} · Restricted Distribution
        </div>
      </div>
    </div>
  );
}

/* --- Table of contents --- */
function TableOfContentsPage({ pages }: { pages: ManualPage[] }) {
  /* List every page except the cover itself; show the page number in
     the manual (1-indexed). Module pages get their full printed title;
     the TOC entry shows the title in stencil to match the front matter
     and the page number in mono with leader dots. */
  return (
    <article className="reveal">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight ink-text-bold">
          Table of Contents
        </h1>
        <span className="font-mono italic text-[11px] text-ink/55">
          Front Matter · §I
        </span>
      </div>
      <hr className="ink-rule mb-5" />

      <p className="font-serif italic text-[13px] text-ink/75 mb-5">
        Sections appear in the order printed. Refer to the running header
        for the active section number.
      </p>

      <ul className="space-y-1.5">
        {pages.map((p, i) => {
          if (p.kind === "cover") return null;
          const pageNum = i + 1;
          const isToc = p.kind === "toc";
          return (
            <li
              key={i}
              className="flex items-baseline gap-2 font-serif text-[14px] sm:text-[15px]"
            >
              <span className="font-stencil text-stamp text-base shrink-0">
                {isToc ? "i" : romanLower(pageNum - 1)}.
              </span>
              <span className="font-stencil tracking-[0.05em] text-ink shrink-0">
                {p.title}
              </span>
              <span className="ink-leader" aria-hidden />
              <span className="font-mono text-[12px] text-ink/85 shrink-0 tabular-nums">
                p. {String(pageNum).padStart(2, "0")}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="ink-divider mt-8">❦</div>
      <p className="font-serif italic text-[11px] text-ink/55 text-center">
        Some sections may not apply to your specific assembly.
        Cross-reference catalog code on the cover.
      </p>
    </article>
  );
}

/* Lowercase roman numerals — fine for short TOC entries (i, ii, iii …). */
function romanLower(n: number): string {
  if (n < 1) return "i";
  const numerals: Array<[number, string]> = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  for (const [val, sym] of numerals) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

function ManualPageView({
  page,
  pages,
  index,
  total,
  seed,
}: {
  page: ManualPage;
  pages: ManualPage[];
  index: number;
  total: number;
  seed: number;
}) {
  /* Cover is rendered by ManualView directly with no header/nav chrome.
     TOC keeps the normal header/nav but uses its own body layout. */
  if (page.kind === "toc") {
    return <TableOfContentsPage pages={pages} />;
  }
  /* `seed` is passed through for any future per-bomb flavor on standard
     pages; not currently used here. */
  void seed;
  return (
    /* Page is printed text on continuous paper — no inverted bars, no
     boxes around content. Title is a serif display headline with a
     thin ink rule beneath, and a small rubber-stamp seal sits to the
     right like an over-printed classification mark. */
    <article className="max-w-3xl reveal">
      <div className="flex items-start justify-between gap-4 mt-1">
        <h1 className="font-serif text-2xl sm:text-4xl font-bold tracking-tight mb-1 ink-text-bold flex-1">
          {page.title}
        </h1>
        <span
          className="ink-seal flex-none"
          aria-label="Classified · Sector 7"
          title="Classified · Sector 7"
        >
          CLASSIFIED · SEC 7
        </span>
      </div>
      <div className="ink-divider">❦</div>

      {page.sections.map((section, si) => (
        <section key={si} className="mb-6 sm:mb-7">
          <h2 className="font-serif text-base sm:text-lg font-bold mb-3 ink-text-bold tracking-tight">
            {section.heading}
          </h2>

          {section.content.map((block, bi) => {
            if (block.type === "paragraph") {
              const isFirst = si === 0 && bi === 0;
              return (
                <p
                  key={bi}
                  className={`font-serif text-[14px] sm:text-[15px] leading-relaxed mb-3 text-ink/85 ${
                    isFirst ? "manual-dropcap" : ""
                  }`}
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
              /* Numbered rule, printed as a paragraph entry. The marker
                 number is the rule's index within this section. */
              const ruleNum = section.content
                .slice(0, bi + 1)
                .filter((b) => b.type === "rule").length;
              return (
                <p
                  key={bi}
                  className="font-serif text-[14px] sm:text-[15px] leading-relaxed mb-2 text-ink/90 pl-7 -indent-7"
                >
                  <span className="font-stencil text-stamp text-base mr-1.5 tracking-wider">
                    {ruleNum}.
                  </span>
                  <span className="italic">If</span> {block.condition}
                  {", "}
                  <span className="italic">then</span>{" "}
                  <span className="font-bold ink-text-bold">{block.action}</span>.
                </p>
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

            if (block.type === 'morseAlphabet') {
              return <MorseAlphabetBlock key={bi} />;
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
                <figure key={bi} className="mb-5">
                  <div className="flex items-baseline justify-between text-[11px] font-serif italic text-ink/65 mb-1">
                    <span>Symbol columns — press order is top → bottom.</span>
                  </div>
                  <hr className="ink-rule-hair mb-2" />
                  <div className="flex w-full">
                    {block.columns.map((col, ci) => (
                      <div
                        key={ci}
                        className="flex-1 min-w-0 flex flex-col items-center gap-0.5 px-1 py-1"
                      >
                        <div className="font-serif italic text-[10px] text-ink/55 mb-0.5">
                          col. {["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][ci]}
                        </div>
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
                  <hr className="ink-rule-hair mt-2" />
                </figure>
              );
            }

            return null;
          })}
        </section>
      ))}

      {/* Page foot — a printed folio in the centre, like a book.
         The leaf decoration on the sides is a small print mark, not a
         banner. The Acme imprint sits below the folio in italic. */}
      <div className="mt-10 sm:mt-12 flex flex-col items-center gap-1 text-ink/55 font-serif">
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-ink/35">❦</span>
          <span className="font-bold ink-text-bold">— {index + 1} —</span>
          <span className="text-ink/35">❦</span>
        </div>
        <div className="italic text-[11px] text-ink/50">
          Acme Defusal Division · M-7
        </div>
      </div>
    </article>
  );
}
