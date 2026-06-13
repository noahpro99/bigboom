import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  generateManualPages,
  memoryRuleText,
  COMP_OUTCOME_TEXT,
  COMP_OUTCOME_SHORT,
} from "../../lib/generator";
import type {
  ManualPage,
  SimonColor,
  MazeData,
  MemoryStageConfig,
  MorseEntry,
  ModuleType,
  CompWireOutcome,
  WireSeqColor,
  WireSeqLetter,
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

/* Phase machine driving the page flip. Transitions are managed via
   inline transforms (useLayoutEffect on phase change) instead of CSS
   keyframes so we can pick up from arbitrary positions — specifically
   from wherever the user's finger left the page when they released
   past the commit threshold. */
type Phase =
  | { kind: "idle" }
  | { kind: "dragging" }
  | { kind: "exiting"; targetIdx: number; direction: 1 | -1 }
  | { kind: "entering"; from: 1 | -1 };

const EXIT_MS = 320;
const ENTER_MS = 380;
const SNAP_MS = 260;

export function ManualView({ seed, moduleTypes }: ManualViewProps) {
  const pages = generateManualPages(seed, moduleTypes);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const page = pages[selectedIdx];
  const atFirst = selectedIdx === 0;
  const atLast = selectedIdx === pages.length - 1;
  const animating = phase.kind !== "idle" && phase.kind !== "dragging";

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;

  /* The active page element — every transform sequence (drag, exit,
     enter, snap-back) lives on its style.transform. Re-mounts on
     selectedIdx change because of the key prop below. */
  const mainRef = useRef<HTMLElement | null>(null);

  /* pendingTargetRef = "where the user has told us to end up", as an
     absolute page index. Each swipe just updates this; the animation
     state machine catches up. While an exit is in flight, additional
     swipes change the target but don't trigger new animations — when
     the in-flight exit lands, we jump selectedIdx straight to the
     LATEST target, skipping past intermediates. Net result: ten quick
     swipes land you ten pages ahead with one visible animation, not
     ten chained ones. */
  const pendingTargetRef = useRef(selectedIdx);

  function clampedTarget(idx: number): number {
    return Math.max(0, Math.min(pages.length - 1, idx));
  }

  function startExitToward(target: number) {
    if (target === selectedIdxRef.current) return;
    const direction = (target > selectedIdxRef.current ? 1 : -1) as 1 | -1;
    play("pageTurn");
    setPhase({ kind: "exiting", targetIdx: target, direction });
  }

  function queueFlipBy(direction: -1 | 1) {
    const next = clampedTarget(pendingTargetRef.current + direction);
    if (next === pendingTargetRef.current) return; // hit edge
    pendingTargetRef.current = next;
    /* If we're idle, kick off animation now. If exiting/entering, the
       running cycle will land at pendingTargetRef when it ends. */
    if (phaseRef.current.kind === "idle") {
      startExitToward(pendingTargetRef.current);
    }
  }

  /* Drive the actual transform whenever the phase changes. */
  useLayoutEffect(() => {
    const m = mainRef.current;
    if (!m) return;
    if (phase.kind === "idle") {
      /* Reset cleanly. If we just returned from a snap-back the prior
         frame already set this; harmless to repeat. */
      m.style.transition = "";
      m.style.transform = "";
      m.style.opacity = "";
    } else if (phase.kind === "dragging") {
      /* Drag transform is set imperatively by handlePointerMove —
         we only ensure no transition is in flight here. */
      m.style.transition = "none";
    } else if (phase.kind === "exiting") {
      const width = m.offsetWidth || 1;
      const targetX = phase.direction > 0 ? -width * 0.42 : width * 0.42;
      const tilt = phase.direction > 0 ? -1.4 : 1.4;
      m.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 0.8, 0.2), opacity ${EXIT_MS}ms`;
      m.style.transform = `translateX(${targetX}px) translateY(-6px) rotate(${tilt}deg)`;
      m.style.opacity = "0";
    } else if (phase.kind === "entering") {
      const width = m.offsetWidth || 1;
      const startX = phase.from > 0 ? width * 0.42 : -width * 0.42;
      const startTilt = phase.from > 0 ? 1.2 : -1.2;
      /* Snap to start position with no transition, force reflow, then
         transition home. */
      m.style.transition = "none";
      m.style.transform = `translateX(${startX}px) translateY(-4px) rotate(${startTilt}deg)`;
      m.style.opacity = "0";
      void m.offsetHeight;
      m.style.transition = `transform ${ENTER_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${ENTER_MS}ms`;
      m.style.transform = "";
      m.style.opacity = "1";
    }
  }, [phase, selectedIdx]);

  /* transitionend on the active element is how we step the phase
     machine — propertyName=="transform" gates against the opacity
     transition firing the same handler twice. */
  function handleTransitionEnd(e: React.TransitionEvent<HTMLElement>) {
    if (e.propertyName !== "transform") return;
    if (e.target !== e.currentTarget) return;
    if (phase.kind === "exiting") {
      const dir = phase.direction;
      /* Jump to the LATEST target, not the target captured when the
         exit was kicked off — extra swipes during the exit may have
         advanced it. The user's intent is always to end up at the
         current pendingTargetRef. */
      const target = pendingTargetRef.current;
      selectedIdxRef.current = target;
      setSelectedIdx(target);
      setPhase({ kind: "entering", from: dir });
    } else if (phase.kind === "entering") {
      /* If swipes arrived during the enter animation, pendingTargetRef
         is ahead of selectedIdx — start one more cycle to catch up. */
      if (pendingTargetRef.current !== selectedIdxRef.current) {
        startExitToward(pendingTargetRef.current);
      } else {
        setPhase({ kind: "idle" });
      }
    }
  }

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

  /* Pointer-driven swipe with live finger-tracking and threshold-commit.
     pointerRef tracks the drag origin; once horizontal motion takes
     over, we set phase to "dragging" and update the active page's
     transform on every move to follow the cursor. On release: past
     SWIPE_THRESHOLD → commit to exiting (which transitions the rest of
     the way from the current position); under threshold → snap back
     to centre. */
  const pointerRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
    captured: boolean;
  } | null>(null);
  const SWIPE_THRESHOLD = 55;
  const TAKEOVER_THRESHOLD = 10;
  /* Resistance when pulling against the edge of the book (no more
     pages in that direction) — the page still moves, but only a
     fraction of the cursor distance, like a rubber-band scroll. */
  const EDGE_RESISTANCE = 0.3;

  function applyDragTransform(rawDx: number) {
    const m = mainRef.current;
    if (!m) return;
    const cur = selectedIdxRef.current;
    let dx = rawDx;
    if ((dx > 0 && cur === 0) || (dx < 0 && cur === pages.length - 1)) {
      dx = dx * EDGE_RESISTANCE;
    }
    /* Tiny rotation proportional to drag distance — gives the page a
       hint of physicality without going overboard. */
    const rot = dx * 0.006;
    m.style.transition = "none";
    m.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
    m.style.opacity = "";
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest(
        "input, button, select, textarea, a, [role='button'], [role='slider'], [data-no-swipe]"
      )
    ) {
      return;
    }
    /* Don't start a drag mid-animation — let the in-flight transition
       finish first. The queue handles overflow swipes. */
    if (phaseRef.current.kind !== "idle") return;
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
      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
      /* Switch into dragging phase — useLayoutEffect clears any
         transition so the next applyDragTransform is instant. */
      setPhase({ kind: "dragging" });
    }
    if (s.captured && phaseRef.current.kind === "dragging") {
      applyDragTransform(dx);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const s = pointerRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    pointerRef.current = null;
    if (!s.captured) return;
    const m = mainRef.current;
    if (!m) return;
    const dx = e.clientX - s.x;

    if (phaseRef.current.kind !== "dragging") return;

    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      const direction = (dx < 0 ? 1 : -1) as 1 | -1;
      const target = selectedIdxRef.current + direction;
      if (target < 0 || target >= pages.length) {
        /* Past threshold but no page to go to — snap back. */
        m.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${SNAP_MS}ms`;
        m.style.transform = "";
        m.style.opacity = "";
        setPhase({ kind: "idle" });
        return;
      }
      /* Sync pendingTargetRef so the queue knows where we're heading
         (and future swipes can advance past this target). */
      pendingTargetRef.current = target;
      play("pageTurn");
      setPhase({ kind: "exiting", targetIdx: target, direction });
    } else {
      /* Below threshold — snap back to centre with a soft easing. */
      m.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${SNAP_MS}ms`;
      m.style.transform = "";
      m.style.opacity = "";
      setPhase({ kind: "idle" });
    }
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
          ref={mainRef}
          onTransitionEnd={handleTransitionEnd}
          className={page.kind === "cover" ? "h-full" : "min-h-full"}
          style={{ willChange: "transform, opacity" }}
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
  /* tables[i] where i = strikes * 2 + (vowel ? 1 : 0).
     The full 6-column matrix (vowel × strikes) doesn't fit on mobile;
     split into TWO sub-tables — "No vowel in serial" / "Vowel in serial"
     — that stack on narrow screens and sit side-by-side on sm+. Each
     sub-table is 1 Flash column + 3 strike columns, comfortable to
     read at any width. */
  const STRIKES = [
    { strikes: 0, head: "0 strikes" },
    { strikes: 1, head: "1 strike" },
    { strikes: 2, head: "2+ strikes" },
  ];
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-serif italic text-[12px] tracking-wide text-ink/75">
          If the bomb flashes the colour at left, press the colour shown
          under your serial / strikes column.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        {([false, true] as const).map((vowel) => (
          <SimonSubTable
            key={vowel ? "vowel" : "novowel"}
            label={vowel ? "Vowel in serial" : "No vowel in serial"}
            tables={tables}
            vowel={vowel}
            strikes={STRIKES}
          />
        ))}
      </div>
    </div>
  );
}

function SimonSubTable({
  label,
  tables,
  vowel,
  strikes,
}: {
  label: string;
  tables: Array<Record<SimonColor, SimonColor>>;
  vowel: boolean;
  strikes: Array<{ strikes: number; head: string }>;
}) {
  return (
    <div>
      <div className="font-mono font-bold text-[10px] uppercase tracking-[0.22em] pb-1 border-b-[1.2px] border-ink/85 ink-text-bold mb-1">
        {label}
      </div>
      <table className="w-full border-collapse font-serif text-[13px] sm:text-[14px] ink-text">
        <thead>
          <tr>
            <th className="text-left align-bottom font-bold text-[10px] uppercase tracking-[0.18em] pb-1 pr-1 border-b border-ink/40 ink-text-bold whitespace-nowrap">
              Flash
            </th>
            {strikes.map((s) => (
              <th
                key={s.strikes}
                className="text-center align-bottom font-mono font-medium text-[10px] tracking-[0.1em] px-1 pb-1 border-b border-ink/40 text-ink/80 whitespace-nowrap"
              >
                {s.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIMON_LIST.map((flash) => (
            <tr key={flash} className="border-b border-ink/20 last:border-b-0">
              <td className="align-middle pr-1 py-1.5">
                <SimonColorText color={flash} bold />
              </td>
              {strikes.map((s) => {
                const idx = s.strikes * 2 + (vowel ? 1 : 0);
                const press = tables[idx][flash];
                return (
                  <td
                    key={s.strikes}
                    className="align-middle text-center px-1 py-1.5"
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
/* Wire Sequences — three per-colour tables. Each table has 9 rows
   (1st-9th occurrence of that colour); each cell says which letters
   to cut. Empty row = "don't cut anything for the Nth wire of this
   colour". */
function WireSeqTablesBlock({
  tables,
}: {
  tables: Record<WireSeqColor, WireSeqLetter[][]>;
}) {
  const COLORS: WireSeqColor[] = ["red", "blue", "black"];
  const COLOR_INK: Record<WireSeqColor, string> = {
    red: "#a8201a",
    blue: "#1d3f8e",
    black: "#1f2937",
  };
  return (
    <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
      {COLORS.map((c) => (
        <div key={c}>
          <div
            className="font-mono font-bold text-[10px] uppercase tracking-[0.22em] pb-1 border-b-[1.2px] mb-1 ink-text-bold"
            style={{ color: COLOR_INK[c] }}
          >
            {c} wires
          </div>
          <table className="w-full border-collapse font-serif text-[13px] ink-text">
            <thead>
              <tr>
                <th className="text-left font-bold text-[10px] uppercase tracking-[0.18em] pb-0.5 pr-2 border-b border-ink/40 ink-text-bold">
                  Nth
                </th>
                <th className="text-left font-bold text-[10px] uppercase tracking-[0.18em] pb-0.5 border-b border-ink/40 ink-text-bold">
                  Cut
                </th>
              </tr>
            </thead>
            <tbody>
              {tables[c].map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-ink/20 last:border-b-0"
                >
                  <td className="py-1 pr-2 font-mono text-ink/75 tabular-nums w-6">
                    {i + 1}
                  </td>
                  <td className="py-1 font-stencil tracking-[0.18em] ink-text-bold">
                    {row.length === 0 ? (
                      <span className="text-ink/45 italic font-serif tracking-normal">
                        none
                      </span>
                    ) : (
                      row.join(" ")
                    )}
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

/* Who's On First — two tables, side-by-side on desktop, stacked on
   mobile. The display-position table maps each pool word to a button
   position 1-6; the priority table is each word's ordered priority
   list. Both fit on one manual page because the pool is bounded. */
function WhoTablesBlock({
  pool,
  displayPosTable,
  priorityTable,
}: {
  pool: string[];
  displayPosTable: Record<string, number>;
  priorityTable: Record<string, string[]>;
}) {
  /* Alphabetical scan order matches what an expert would do under
     pressure ("D… DISPLAY… here it is, position 3"). */
  const sortedPool = [...pool].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
      <div>
        <div className="font-mono font-bold text-[10px] uppercase tracking-[0.22em] pb-1 border-b-[1.2px] border-ink/85 ink-text-bold mb-1">
          Display → button position
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-serif text-[12px]">
          {sortedPool.map((w) => (
            <div
              key={w}
              className="flex items-baseline gap-2 leading-snug"
            >
              <span className="font-bold ink-text-bold tracking-wide flex-1 truncate">
                {w}
              </span>
              <span className="font-mono text-ink/85 tabular-nums">
                {displayPosTable[w]}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="font-mono font-bold text-[10px] uppercase tracking-[0.22em] pb-1 border-b-[1.2px] border-ink/85 ink-text-bold mb-1">
          Word → priority order
        </div>
        <div className="font-serif text-[12px] leading-snug space-y-1.5">
          {sortedPool.map((w) => (
            <div key={w}>
              <span className="font-bold ink-text-bold tracking-wide">
                {w}
              </span>
              <span className="text-ink/85 ml-2">
                {priorityTable[w].join(", ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Complicated Wires Venn diagram. Four overlapping ellipses — one per
   wire flag (Red, Blue, Star, LED) — drawn in widely varied positions
   per bomb. Each region's outcome shorthand is placed at the region's
   *pole of inaccessibility* (the deepest interior point) rather than
   its centroid, so labels never fall on a region's narrow waist. Font
   sizes scale with the inscribed radius; regions too small for even
   the smallest font drop the label entirely.

   Per-bomb generation tries multiple candidate layouts and keeps the
   one whose smallest non-empty region has the most space — different
   bombs get genuinely different geometries (rotation, ellipse
   eccentricities, ring radius, stroke styles, stroke widths). */
function CompWireTableBlock({ table }: { table: CompWireOutcome[] }) {
  /* Visual seed — folds the outcome table into a 32-bit hash so
     bombs with identical tables stay identical (and most pairs
     differ). djb2 walk. */
  const visualSeed = (() => {
    let h = 5381 >>> 0;
    for (let i = 0; i < table.length; i++) {
      h = ((h << 5) + h + table[i].charCodeAt(0)) >>> 0;
    }
    return h || 1;
  })();
  const rng = miniRng(visualSeed);

  const W = 360;
  const H = 300;

  /* Each flag gets a colour + one of four line styles. We pick a
     random rotation through the styles per bomb. */
  const STYLES = ["solid", "dashed", "dotted", "dashdot"] as const;
  const DASH_FOR: Record<typeof STYLES[number], string> = {
    solid: "0",
    dashed: "10 5",
    dotted: "2 4",
    dashdot: "8 4 2 4",
  };
  const styleStart = Math.floor(rng() * 4);
  const strokeWidth = 1.2 + rng() * 0.8; // 1.2..2.0
  const flagMeta = [
    { name: "Red", color: "#a8201a" },
    { name: "Blue", color: "#1d3f8e" },
    { name: "Star", color: "#a17418" },
    { name: "LED", color: "#176f3f" },
  ].map((m, i) => ({
    ...m,
    style: STYLES[(styleStart + i) % STYLES.length],
  }));

  /* Generate candidate layouts and keep the one with the best worst
     region. Each candidate widely varies:
       - overall rotation (full 360°)
       - per-ellipse base angle spread (compressed vs expanded
         around the 90° spacing)
       - ring radius (how spread out the lobes are)
       - per-ellipse eccentricity (tall vs round)
       - per-ellipse individual jitter
     The deeper the smallest region's inscribed radius, the more
     legible the labels will be. */
  let best: {
    ellipses: Ellipse[];
    poles: Array<{ x: number; y: number; r: number } | null>;
    worst: number;
  } | null = null;
  const ATTEMPTS = 18;
  for (let n = 0; n < ATTEMPTS; n++) {
    const ellipses = rollEllipses(rng);
    const poles = computeRegionPoles(ellipses, W, H);
    /* Worst is the smallest inscribed radius among NON-EMPTY regions.
       We treat key 0 (outside all four — usually a big rectangle of
       empty space) as a special case to avoid distorting the score. */
    let worst = Infinity;
    for (let k = 1; k < 16; k++) {
      const p = poles[k];
      if (p && p.r < worst) worst = p.r;
    }
    if (!best || worst > best.worst) {
      best = { ellipses, poles, worst };
    }
    /* Stop early once we hit a comfortable score. */
    if (best.worst >= 14) break;
  }
  const ellipses = best!.ellipses;
  const poles = best!.poles;

  /* Outer flag titles — placed just outside each ellipse on the far
     side of the diagram from the origin, with a soft halo so the
     ellipse line doesn't slice through the lettering. */
  const outerLabels = ellipses.map((e, i) => {
    const dir = Math.atan2(e.cy, e.cx);
    const r = Math.hypot(e.cx, e.cy) + e.a * 0.95 + 6;
    return {
      x: Math.cos(dir) * r,
      y: Math.sin(dir) * r,
      ...flagMeta[i],
    };
  });

  return (
    <div className="mb-5">
      <svg
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        className="w-full max-w-[560px] mx-auto h-auto block"
        style={{ color: "var(--color-ink)" }}
      >
        {/* Outer flag titles */}
        {outerLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={l.color}
            fontFamily="var(--font-stencil, sans-serif)"
            fontSize="15"
            fontWeight="700"
            style={{ letterSpacing: "0.15em" }}
            paintOrder="stroke"
            stroke="var(--color-paper)"
            strokeWidth="4"
            strokeLinejoin="round"
          >
            {l.name}
          </text>
        ))}

        {/* The four ellipses */}
        {ellipses.map((e, i) => (
          <ellipse
            key={i}
            cx={e.cx}
            cy={e.cy}
            rx={e.a}
            ry={e.b}
            transform={`rotate(${(e.rot * 180) / Math.PI} ${e.cx} ${e.cy})`}
            fill="none"
            stroke={flagMeta[i].color}
            strokeWidth={strokeWidth}
            strokeDasharray={DASH_FOR[flagMeta[i].style]}
            strokeLinecap="round"
            opacity="0.88"
          />
        ))}

        {/* One label per non-empty region, scaled to the local pole
            radius. Below the minimum-readable threshold we drop the
            label entirely — better than overflowing the region. */}
        {poles.map((p, key) => {
          if (!p) return null;
          const text = COMP_OUTCOME_SHORT[table[key]];
          /* Each character is roughly fontSize * 0.6 wide. Solve
             for a font size that lets the whole label fit inside a
             circle of radius p.r centred at the pole. We bound the
             size to a readable range and drop the label if even the
             smallest size won't fit. */
          const charW = text.length * 0.62;
          const fitForRadius = Math.min(p.r * 1.7, (p.r * 2) / charW);
          const fontSize = Math.max(7.2, Math.min(13, fitForRadius));
          if (fontSize < 7.2) return null;
          return (
            <text
              key={key}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--color-ink)"
              fontFamily="var(--font-mono, monospace)"
              fontSize={fontSize.toFixed(1)}
              fontWeight="700"
              style={{ letterSpacing: "0.04em" }}
            >
              {text}
            </text>
          );
        })}
      </svg>

      {/* Legend — explains what each outcome shorthand resolves to. */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[12px] font-serif">
        {(Object.keys(COMP_OUTCOME_SHORT) as CompWireOutcome[]).map((k) => (
          <div key={k} className="flex items-baseline gap-2">
            <span className="font-mono font-bold ink-text-bold w-12 shrink-0">
              {COMP_OUTCOME_SHORT[k]}
            </span>
            <span className="text-ink/85">{COMP_OUTCOME_TEXT[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Pick one candidate ellipse layout with wide per-bomb variation. */
function rollEllipses(rng: () => number): Ellipse[] {
  const baseRotation = rng() * Math.PI * 2;
  /* Spread factor — how compressed/expanded the four base angles
     are. 1.0 = perfectly even (90° apart), > 1 pulls neighbours
     apart, < 1 cluster them. */
  const spread = 0.78 + rng() * 0.6;
  const ringR = 40 + rng() * 22; // 40..62 — how far from origin
  /* Per-ellipse jitter range — bigger means weirder asymmetric
     layouts. */
  const jitter = 0.08 + rng() * 0.22;
  return [0, 1, 2, 3].map((i) => {
    const baseAngle = (i * Math.PI) / 2 * spread + ((Math.PI / 2) * (1 - spread)) * i;
    const angle = baseAngle + baseRotation + (rng() - 0.5) * jitter;
    const r = ringR + (rng() - 0.5) * 14;
    const a = 78 + rng() * 22; // 78..100 semi-major
    const b = 42 + rng() * 18; // 42..60 semi-minor
    const cx = Math.cos(angle) * r;
    const cy = Math.sin(angle) * r;
    /* The ellipse's own rotation — tangent to the ring plus a small
       extra twist. */
    const rot = angle + Math.PI / 2 + (rng() - 0.5) * 0.4;
    return { cx, cy, a, b, rot };
  });
}

/* Tiny inline mulberry32. */
function miniRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ellipse {
  cx: number;
  cy: number;
  a: number;
  b: number;
  rot: number;
}

/* For each of the 16 (R/B/S/L) combinations, find the pole of
   inaccessibility — the sample point with the greatest minimum
   distance to any ellipse boundary. That's the deepest interior
   point of the region, the natural spot for a label. We also return
   the inscribed radius `r` so callers can size labels to fit. */
function computeRegionPoles(
  ellipses: Ellipse[],
  W: number,
  H: number
): Array<{ x: number; y: number; r: number } | null> {
  /* Best (max) margin per region key, plus its position. We sample on
     a 4px grid which is plenty for stable poles without blowing up
     compute. */
  const STEP = 4;
  const best: Array<{ x: number; y: number; r: number } | null> = Array.from(
    { length: 16 },
    () => null
  );
  for (let y = -H / 2; y <= H / 2; y += STEP) {
    for (let x = -W / 2; x <= W / 2; x += STEP) {
      let key = 0;
      let minMargin = Infinity;
      for (let i = 0; i < ellipses.length; i++) {
        const m = ellipseSignedMargin(x, y, ellipses[i]);
        const inside = m >= 0;
        if (inside) key |= 1 << (3 - i);
        /* Distance to the nearest boundary (in pixel-ish units) is
           |margin| — whether we're inside or outside doesn't matter
           for "how far to the boundary." */
        const dist = Math.abs(m);
        if (dist < minMargin) minMargin = dist;
      }
      const cur = best[key];
      if (!cur || minMargin > cur.r) {
        best[key] = { x, y, r: minMargin };
      }
    }
  }
  return best;
}

/* Signed approximate margin from a point to an ellipse boundary:
   positive when inside, negative when outside. Uses the difference
   between the normalised distance and 1, scaled by min(a, b) so the
   result is in roughly pixel units (good enough for label sizing). */
function ellipseSignedMargin(x: number, y: number, e: Ellipse): number {
  const dx = x - e.cx;
  const dy = y - e.cy;
  const cos = Math.cos(-e.rot);
  const sin = Math.sin(-e.rot);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const norm = Math.sqrt((rx / e.a) ** 2 + (ry / e.b) ** 2);
  return (1 - norm) * Math.min(e.a, e.b);
}

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
              return <PasswordDictBlock key={bi} words={block.words} />;
            }

            if (block.type === 'compWireTable') {
              return <CompWireTableBlock key={bi} table={block.table} />;
            }

            if (block.type === 'whoTables') {
              return (
                <WhoTablesBlock
                  key={bi}
                  pool={block.pool}
                  displayPosTable={block.displayPosTable}
                  priorityTable={block.priorityTable}
                />
              );
            }

            if (block.type === 'wireSeqTables') {
              return <WireSeqTablesBlock key={bi} tables={block.tables} />;
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
