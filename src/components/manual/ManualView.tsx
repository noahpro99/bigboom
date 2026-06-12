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
import { ProfileButton } from "../ProfileButton";

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
          className={`min-h-full ${animClass}`}
        >
          {/* Running header — printed on the page, no background change.
             Profile/settings chip lives at the far right; even though
             it's a real button it's styled in the same paper-ink tone
             so it reads as a printed icon on the page. */}
          <header className="flex items-center justify-between gap-3 px-4 sm:px-10 pt-3 pb-2 font-serif italic text-[11px] text-ink/65">
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
          <hr className="ink-rule-hair mx-4 sm:mx-10" />

          <div className="py-5 sm:py-8 px-4 sm:px-10">
            <ManualPageView
              page={page}
              index={selectedIdx}
              total={pages.length}
            />
          </div>

          {/* Foot nav — printed tap targets. */}
          <footer className="px-4 sm:px-10 pb-5">
            <hr className="ink-rule-hair mb-2" />
            <div className="flex items-baseline justify-between font-serif italic text-[12px] text-ink/70">
              <button
                onClick={() => flipTo(selectedIdx - 1)}
                disabled={atFirst || animating}
                aria-label="Previous page"
                className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors"
              >
                <ChevronLeft size={13} strokeWidth={2.2} />
                <span>prev</span>
              </button>
              <span className="text-ink/50 hidden sm:inline">swipe ←→</span>
              <button
                onClick={() => flipTo(selectedIdx + 1)}
                disabled={atLast || animating}
                aria-label="Next page"
                className="flex items-center gap-1 hover:text-ink disabled:opacity-25 transition-colors"
              >
                <span>next</span>
                <ChevronRight size={13} strokeWidth={2.2} />
              </button>
            </div>
          </footer>
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
        <p
          key={i}
          className="font-serif text-[14px] sm:text-[15px] leading-relaxed mb-2 text-ink/90 pl-12 -indent-12"
        >
          <span className="font-stencil text-stamp text-base tracking-[0.15em] mr-2">
            Stage {i + 1}.
          </span>
          <span className="italic text-ink/65">Display shows</span>{" "}
          <span className="font-bold ink-text-bold">{stage.display}</span>
          {" — "}
          {memoryRuleText(stage.rule)}.
        </p>
      ))}
    </div>
  );
}

/* Morse pool — laid out as a two-column printed list. Each entry is
   one paragraph: bold serif word, the Morse encoding in monospace,
   leader dots, then the frequency in bold. No grid lines, no card. */
function MorseTableBlock({ pool }: { pool: MorseEntry[] }) {
  return (
    <div className="mb-5 columns-1 sm:columns-2 gap-x-6">
      {pool.map((entry) => {
        const morse = encodeMorse(entry.word).join("  ");
        return (
          <div
            key={entry.word}
            className="font-serif text-[13px] leading-snug mb-2 break-inside-avoid"
          >
            <div className="font-bold ink-text-bold tracking-wide flex items-baseline gap-2">
              <span>{entry.word}</span>
              <span className="ink-leader" aria-hidden />
              <span className="font-mono font-bold text-ink/90">
                {MORSE_FREQS[entry.freqIndex].toFixed(3)}
              </span>
            </div>
            <div className="font-mono text-[11px] text-ink/65 tracking-tight pl-1">
              {morse}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Password — letter pools rendered as a typeset header (column number
   in italic above each stack of letters), and the dictionary as a
   flowing column of small-caps words like a glossary index. */
function PasswordDictBlock({
  words,
  columns,
}: {
  words: string[];
  columns: string[][];
}) {
  return (
    <div className="mb-5">
      {/* Letter pools — 5 columns of letters, each headed with a roman
         numeral. Aligned via a real <table> so the columns stay even. */}
      <table className="mb-4 mx-auto border-collapse font-serif">
        <thead>
          <tr>
            {columns.map((_, i) => (
              <th
                key={i}
                className="px-3 sm:px-5 pb-1 font-serif italic text-[11px] text-ink/55 align-bottom border-b-[1.2px] border-ink/80"
              >
                col. {["I", "II", "III", "IV", "V"][i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, row) => (
            <tr key={row}>
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  className="px-3 sm:px-5 py-0.5 text-center font-stencil text-[20px] leading-tight ink-text-bold"
                >
                  {col[row]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ink-divider">❦</div>

      <div className="font-serif italic text-[12px] text-ink/65 mb-2">
        Dictionary — only words spellable from the pools above are valid.
      </div>
      <div className="columns-3 sm:columns-4 gap-x-4 font-serif text-[13px] tracking-wide ink-text">
        {words.map((w) => (
          <div key={w} className="leading-relaxed">
            {w}
          </div>
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
