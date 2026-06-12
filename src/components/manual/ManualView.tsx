import { useEffect, useRef, useState } from "react";
import { generateManualPages } from "../../lib/generator";
import type { ManualPage } from "../../lib/types";
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

      {/* Book area: arrows on the sides, animated page in the middle */}
      {/* Book area — the entire row scrolls together so the scrollbar sits at
          the far right edge (past the next-page arrow). Arrows use
          `position: sticky` to stay centered while the page text scrolls. */}
      <div className="flex-1 overflow-auto scrollbar-ink min-h-0 tx-paper-lines">
        <div className="flex items-stretch min-h-full">
          <PageArrow
            dir="prev"
            disabled={atFirst || animating}
            onClick={() => flipTo(selectedIdx - 1)}
          />

          <main
            key={selectedIdx}
            onAnimationEnd={handleAnimationEnd}
            className={`flex-1 py-5 sm:py-10 px-4 sm:px-10 min-w-0 ${animClass}`}
          >
            <ManualPageView
              page={page}
              index={selectedIdx}
              total={pages.length}
            />
          </main>

          <PageArrow
            dir="next"
            disabled={atLast || animating}
            onClick={() => flipTo(selectedIdx + 1)}
          />
        </div>
      </div>

      {/* Page indicator dots */}
      <div className="flex-none flex items-center justify-center gap-2.5 py-3 border-t border-ink/15 bg-paper-dim/40">
        {pages.map((_, i) => {
          const isActive = i === selectedIdx;
          return (
            <button
              key={i}
              onClick={() => flipTo(i)}
              disabled={animating}
              aria-label={`Go to section ${i + 1}`}
              className={`transition-all rounded-full ${
                isActive
                  ? "w-6 h-2 bg-ink"
                  : "w-2 h-2 bg-ink/25 hover:bg-ink/45"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function PageArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous page" : "Next page"}
      className={`shrink-0 self-stretch w-12 flex items-center justify-center transition-all group z-10 ${
        disabled
          ? "opacity-20 cursor-default"
          : "hover:bg-ink/8 active:bg-ink/12 cursor-pointer"
      }`}
    >
      {/* Sticky inner so the icon stays vertically centered in the viewport
         while the page text scrolls and the button hit-area fills the column */}
      <span className="sticky top-1/2 -translate-y-1/2 flex items-center justify-center">
        <Icon
          size={28}
          strokeWidth={2.25}
          className={`text-ink/70 ${
            disabled ? "" : "group-hover:text-ink group-hover:scale-110"
          } transition-all`}
        />
      </span>
    </button>
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
