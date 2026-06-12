import { useState } from "react";
import { generateManualPages } from "../../lib/generator";
import type { ManualPage } from "../../lib/types";
import { BookOpen, ChevronRight, FileText } from "lucide-react";

interface ManualViewProps {
  seed: number;
}

export function ManualView({ seed }: ManualViewProps) {
  const pages = generateManualPages(seed);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const page = pages[selectedIdx];

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

      {/* Mobile: horizontal section tabs */}
      <div className="sm:hidden flex-none overflow-x-auto flex bg-paper-dim border-b border-ink/20 shrink-0">
        {pages.map((p, i) => {
          const isActive = i === selectedIdx;
          return (
            <button
              key={p.moduleType}
              onClick={() => setSelectedIdx(i)}
              className={`flex-shrink-0 px-4 py-3 text-[11px] font-serif font-bold whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? "border-stamp text-ink bg-ink/5"
                  : "border-transparent text-ink/55"
              }`}
            >
              {p.title}
            </button>
          );
        })}
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar — desktop only */}
        <aside className="hidden sm:flex w-56 border-r-2 border-ink/15 pb-6 px-3 flex-col gap-1 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-ink/60 px-2 mt-4 mb-2">
            <FileText size={11} strokeWidth={2} />
            <span>Sections</span>
          </div>
          {pages.map((p, i) => {
            const isActive = i === selectedIdx;
            return (
              <button
                key={p.moduleType}
                onClick={() => setSelectedIdx(i)}
                className={`text-left tab-bookmark px-3 py-2.5 transition-colors relative ${
                  isActive
                    ? "bg-ink text-paper"
                    : "hover:bg-ink/8 text-ink"
                }`}
              >
                <div className="font-serif font-bold text-sm leading-tight">
                  {p.title}
                </div>
                <div
                  className={`text-[10px] font-mono uppercase tracking-widest mt-0.5 ${
                    isActive ? "text-paper/70" : "text-ink/50"
                  }`}
                >
                  §{i + 1}
                </div>
                {isActive && (
                  <ChevronRight
                    size={14}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-paper"
                  />
                )}
              </button>
            );
          })}

          <div className="mt-auto pt-4 border-t border-ink/15 px-2">
            <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-ink/40 leading-relaxed">
              For verbal use only. Do not transmit visual contents.
            </div>
          </div>
        </aside>

        {/* Page content */}
        <main className="flex-1 overflow-auto py-5 sm:py-10 px-4 sm:px-10 tx-paper-lines">
          <ManualPageView page={page} index={selectedIdx} />
        </main>
      </div>
    </div>
  );
}

/* Renders a table as stacked rule-cards on mobile, normal table on desktop */
function ResponsiveTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <>
      {/* Mobile: card-per-row */}
      <div className="sm:hidden mb-3 border border-ink/30 divide-y divide-ink/15 manual-card overflow-hidden">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className={`px-3 py-3 ${ri % 2 === 0 ? "bg-paper" : "bg-paper-stain/30"}`}
          >
            {/* First cell: number/badge header */}
            <div className="mb-2">
              {row[0].length <= 4 ? (
                <span className="font-stencil text-base text-stamp tracking-wider">
                  {row[0]}
                </span>
              ) : (
                <>
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink/45 block mb-0.5">
                    {headers[0]}
                  </span>
                  <span className="font-serif text-[13px]">{row[0]}</span>
                </>
              )}
            </div>
            {/* Remaining cells */}
            {row.slice(1).map((cell, ci) => (
              <div key={ci} className="mb-2 last:mb-0">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink/45 block mb-0.5">
                  {headers[ci + 1]}
                </span>
                <span className="font-serif text-[13px] leading-snug block">
                  {cell}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Desktop: normal table */}
      <div className="hidden sm:block overflow-x-auto mb-3 border border-ink/30 manual-card bg-paper">
        <table className="w-full border-collapse text-sm font-serif">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="bg-ink text-paper px-3.5 py-2.5 text-left font-bold text-[10px] uppercase tracking-[0.2em] border-r border-paper/20 last:border-r-0"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={`border-t border-ink/15 ${
                  ri % 2 === 0 ? "bg-paper" : "bg-paper-stain/35"
                }`}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3.5 py-2.5 align-top text-[13.5px] border-r border-ink/12 last:border-r-0 leading-snug"
                  >
                    {ci === 0 && cell.length <= 3 ? (
                      <span className="font-stencil text-base text-stamp tracking-wider">
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
      </div>
    </>
  );
}

function ManualPageView({ page, index }: { page: ManualPage; index: number }) {
  return (
    <article className="max-w-3xl reveal">
      {/* Page header */}
      <div className="flex items-end justify-between mb-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/50">
          Section §{index + 1}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/40">
          Page {index + 1} of 2
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
