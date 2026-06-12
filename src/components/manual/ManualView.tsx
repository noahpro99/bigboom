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
    <div className="h-full flex tx-paper text-ink relative">
      {/* Top: classification banner */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-2 bg-ink text-paper border-b-2 border-ink">
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

      {/* Sidebar */}
      <aside className="w-56 border-r-2 border-ink/15 pt-12 pb-6 px-3 flex flex-col gap-1 relative">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-ink/60 px-2 mb-2">
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

        <div className="mt-auto pt-4 border-t border-ink/15">
          <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-ink/40 leading-relaxed">
            For verbal use only. Do not transmit visual contents.
          </div>
        </div>
      </aside>

      {/* Page body */}
      <main className="flex-1 overflow-auto pt-14 pb-10 px-10 tx-paper-lines">
        <ManualPageView page={page} index={selectedIdx} />
      </main>
    </div>
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

      <h1 className="font-serif text-4xl font-bold tracking-tight mt-1 mb-5 pb-3 border-b-2 border-ink">
        {page.title}
      </h1>

      {page.sections.map((section, si) => (
        <section key={si} className="mb-7">
          <h2 className="font-serif text-lg font-bold mb-3 text-ink">
            {section.heading}
          </h2>

          {section.content.map((block, bi) => {
            if (block.type === "paragraph") {
              return (
                <p
                  key={bi}
                  className="font-serif text-[15px] leading-relaxed mb-3 text-ink/85"
                >
                  {block.text}
                </p>
              );
            }

            if (block.type === "table") {
              return (
                <div
                  key={bi}
                  className="overflow-x-auto mb-3 border border-ink/30 manual-card bg-paper"
                >
                  <table className="w-full border-collapse text-sm font-serif">
                    <thead>
                      <tr>
                        {block.headers.map((h, i) => (
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
                      {block.rows.map((row, ri) => (
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
              );
            }

            if (block.type === "rule") {
              return (
                <div
                  key={bi}
                  className="flex gap-4 items-start mb-2 p-3 border-l-4 border-stamp/60 bg-paper-stain/30"
                >
                  <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/55 mt-0.5">
                    IF
                  </span>
                  <span className="text-sm flex-1 font-serif">
                    {block.condition}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/55 mt-0.5">
                    THEN
                  </span>
                  <span className="text-sm font-bold flex-1 font-serif">
                    {block.action}
                  </span>
                </div>
              );
            }

            return null;
          })}
        </section>
      ))}

      {/* Footer stamp */}
      <div className="mt-10 flex items-end justify-between">
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
