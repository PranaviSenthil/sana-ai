import { useMemo, useState, useId } from "react";
import type { NotebookDoc, NotebookBlock } from "@/lib/study-notes.schema";
import { BlockRenderer } from "./blocks";
import { Key, FileText, CheckCircle2, Bookmark, Eye, EyeOff, Sparkles, HelpCircle, Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";

export function CornellViewer({ doc }: { doc: NotebookDoc }) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [recallMode, setRecallMode] = useState(false);
  const [revealedBlocks, setRevealedBlocks] = useState<Record<string, boolean>>({});
  const [revisionMode, setRevisionMode] = useState(false);
  const [cuesExpandedMobile, setCuesExpandedMobile] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const componentId = useId();

  // Extract cues, main notes, and summaries from doc blocks
  const { cues, notes, summaryItems } = useMemo(() => {
    const cuesList: Array<{ id: string; text: string; targetId: string }> = [];
    const mainNotes: Array<{ id: string; block: NotebookBlock }> = [];
    const summaries: string[] = [];

    doc.blocks.forEach((b, idx) => {
      if (!b) return;
      const blockId = `cornell-block-${componentId}-${idx}`.replace(/:/g, '');

      if (b.kind === "section") {
        cuesList.push({ id: `cue-${idx}`, text: b.text, targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "definition") {
        if (b.term) {
          cuesList.push({ id: `cue-${idx}`, text: `Define: ${b.term}`, targetId: blockId });
        }
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "formula") {
        if (b.label) {
          cuesList.push({ id: `cue-${idx}`, text: `Formula: ${b.label}`, targetId: blockId });
        }
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "memory") {
        cuesList.push({ id: `cue-${idx}`, text: `Memory Cue`, targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "checklist") {
        cuesList.push({ id: `cue-${idx}`, text: "Checklist Steps", targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "revision") {
        cuesList.push({ id: `cue-${idx}`, text: "Revision Points", targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "mistake") {
        cuesList.push({ id: `cue-${idx}`, text: "Avoid Mistakes", targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "code") {
        cuesList.push({ id: `cue-${idx}`, text: `Code: ${b.language}`, targetId: blockId });
        mainNotes.push({ id: blockId, block: b });
      } else if (b.kind === "summary") {
        summaries.push(b.text);
      } else {
        mainNotes.push({ id: blockId, block: b });
      }
    });

    // Fallback if only generic/no cues could be extracted
    if (cuesList.length <= 1 && mainNotes.length > 0) {
      mainNotes.forEach((n, idx) => {
        if (n.block.kind === "paragraph") {
          const text = n.block.text || "";
          if (text.includes("?") || text.length < 60) {
            cuesList.push({
              id: `cue-auto-${idx}`,
              text: text.length > 40 ? text.slice(0, 38) + "..." : text,
              targetId: n.id,
            });
          } else if (idx < 4) {
            const words = text.split(" ").slice(0, 3).join(" ");
            cuesList.push({
              id: `cue-auto-${idx}`,
              text: words + "...",
              targetId: n.id,
            });
          }
        }
      });
    }

    // Fallback: if no summary block exists, use the last paragraph as a summary takeaway!
    if (summaries.length === 0) {
      const paragraphs = doc.blocks.filter((b) => b?.kind === "paragraph");
      if (paragraphs.length > 0) {
        const lastP = paragraphs[paragraphs.length - 1];
        if (lastP.text && lastP.text.length > 10) {
          summaries.push(lastP.text);
        }
      }
    }

    return { cues: cuesList, notes: mainNotes, summaryItems: summaries };
  }, [doc]);

  const handleCueClick = (targetId: string) => {
    setActiveBlockId(targetId);
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Briefly highlight the notes section
    setTimeout(() => {
      setActiveBlockId((curr) => (curr === targetId ? null : curr));
    }, 2000);
  };

  const handleToggleReveal = (blockId: string) => {
    setRevealedBlocks((prev) => ({
      ...prev,
      [blockId]: !prev[blockId],
    }));
  };

  const handleRevealAll = () => {
    const nextRevealed: Record<string, boolean> = {};
    notes.forEach((n) => {
      nextRevealed[n.id] = true;
    });
    setRevealedBlocks(nextRevealed);
  };

  const handleHideAll = () => {
    setRevealedBlocks({});
  };

  return (
    <div
      className={cn(
        "w-full rounded-3xl border-2 border-slate-800 bg-[#FFFDF9] p-4 sm:p-6 shadow-xl text-slate-800 flex flex-col justify-between transition-all",
        isFullScreen ? "fixed inset-0 z-50 overflow-y-auto" : "relative max-h-[78vh] overflow-y-auto"
      )}
    >
      {/* Header bar */}
      <div className="shrink-0 border-b-2 border-slate-800 pb-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-slate-600">
          <div className="flex items-center gap-1.5 truncate">
            <Bookmark className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>Subject:</span>
            <span className="text-slate-900 font-extrabold truncate max-w-[150px] sm:max-w-none">
              {doc.title}
            </span>
          </div>
          <div className="hidden md:block text-indigo-800 font-black tracking-widest bg-indigo-50 border border-indigo-200 px-3 py-0.5 rounded-full text-[10px]">
            CORNELL STUDY SYSTEM
          </div>
          <div className="flex items-center gap-2 text-slate-500 font-semibold">
            <div>Date: <span className="text-slate-800">{new Date().toLocaleDateString()}</span></div>
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="rounded-xl border border-slate-300 bg-white p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 ml-2 cursor-pointer shadow-sm"
              title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullScreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Toolbar & Interactive Toggles */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 p-2.5 rounded-2xl">
          <div className="flex flex-wrap items-center gap-2">
            {/* Recall Mode Toggle */}
            <button
              onClick={() => {
                setRecallMode(!recallMode);
                if (!recallMode) handleHideAll();
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                recallMode
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
              )}
            >
              {recallMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{recallMode ? "Active Recall ON" : "Recall Mode"}</span>
            </button>

            {/* Summary / Revision Mode Toggle */}
            <button
              onClick={() => setRevisionMode(!revisionMode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                revisionMode
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{revisionMode ? "Summary Review ON" : "Summary Review"}</span>
            </button>
          </div>

          {/* Reveal All / Hide All buttons (visible only when recall mode is enabled and not in revision mode) */}
          {recallMode && !revisionMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRevealAll}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
              >
                Reveal All
              </button>
              <button
                onClick={handleHideAll}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
              >
                Hide All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main split-pane content */}
      <div className="grow">
        {revisionMode ? (
          /* Summary Review Mode Layout: Collapses notes and displays Cues & Summary Side-by-side or stacked */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[340px]">
            {/* Cues column */}
            <div className="space-y-3 bg-purple-50/50 p-5 rounded-2xl border border-purple-100">
              <div className="text-xs font-black uppercase text-purple-900 tracking-wider flex items-center gap-1.5 border-b border-purple-200 pb-2.5">
                <Key className="h-3.5 w-3.5 text-purple-700" /> Key Study Cues
              </div>
              <ul className="space-y-2">
                {cues.map((cue, idx) => (
                  <li
                    key={idx}
                    className="rounded-xl bg-white p-3 border border-purple-200 shadow-sm font-semibold text-purple-950 text-xs flex items-start gap-2.5"
                  >
                    <span className="text-purple-500 font-extrabold text-sm leading-none">•</span>
                    <span>{cue.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Quick Summary column */}
            <div className="space-y-3 bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100">
              <div className="text-xs font-black uppercase text-emerald-950 tracking-wider flex items-center gap-1.5 border-b border-emerald-200 pb-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> Key Takeaways & Summary
              </div>
              <div className="space-y-3">
                {summaryItems.length > 0 ? (
                  summaryItems.map((s, i) => (
                    <div key={i} className="text-xs sm:text-sm font-medium text-emerald-900 leading-relaxed flex items-start gap-2">
                      <span className="text-emerald-500 font-bold">•</span>
                      <span>{s}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed italic">
                    {doc.title}: Key definitions, formulas, and mnemonic rules summarized for active study.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Normal Cornell Split Layout */
          <div className="flex flex-col md:grid md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] gap-6 min-h-[400px]">
            
            {/* Left Column: Cues (Collapsible drawer layout on Mobile view) */}
            <div className="space-y-3">
              {/* Mobile Cue Accordion Toggle */}
              <button
                onClick={() => setCuesExpandedMobile(!cuesExpandedMobile)}
                className="w-full flex md:hidden items-center justify-between p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-800 font-bold text-xs cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Key className="h-4 w-4 text-purple-700" /> Click to view Cues ({cues.length})
                </span>
                <span className="text-[10px]">{cuesExpandedMobile ? "Hide" : "Show"}</span>
              </button>

              <div
                className={cn(
                  "bg-purple-50/40 p-4 rounded-2xl border border-purple-100 space-y-3 max-h-[460px] overflow-y-auto no-scrollbar transition-all",
                  !cuesExpandedMobile && "hidden md:block",
                  cuesExpandedMobile && "block"
                )}
              >
                <div className="text-xs font-black uppercase text-purple-900 tracking-wider flex items-center gap-1.5 border-b border-purple-200/80 pb-2.5">
                  <Key className="h-3.5 w-3.5 text-purple-700" /> Cues & Keywords
                </div>
                <div className="text-[10px] text-muted-foreground pb-1 leading-snug">
                  Click a cue to view and highlight its notes section.
                </div>
                <ul className="space-y-2">
                  {cues.map((cue, idx) => (
                    <li key={idx}>
                      <button
                        onClick={() => {
                          handleCueClick(cue.targetId);
                          setCuesExpandedMobile(false);
                        }}
                        className="w-full text-left rounded-xl bg-white p-3 border border-purple-100 shadow-sm hover:border-purple-400 hover:bg-purple-50/30 active:scale-[0.99] font-extrabold text-purple-950 text-xs leading-snug transition-all flex items-start gap-2 group cursor-pointer"
                      >
                        <HelpCircle className="h-3.5 w-3.5 text-purple-400 mt-0.5 group-hover:text-purple-600 shrink-0 transition" />
                        <span>{cue.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Right Column: Main Notes Column */}
            <div className="space-y-5 overflow-y-auto no-scrollbar max-h-[560px] pr-1 md:pl-2">
              <div className="text-xs font-black uppercase text-slate-700 tracking-wider border-b border-slate-200 pb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-600" /> Main Notes & Explanations
              </div>
              <div className="space-y-5 pb-6">
                {notes.map((n, i) => {
                  const isActive = activeBlockId === n.id;
                  const isSection = n.block.kind === "section";
                  const showRevealOverlay = recallMode && !isSection && !revealedBlocks[n.id];

                  return (
                    <div
                      key={i}
                      id={n.id}
                      className={cn(
                        "relative pt-1 rounded-2xl transition-all duration-500",
                        isActive && "bg-amber-50/80 ring-4 ring-amber-400/30 p-2 -mx-2 shadow-sm scale-[1.01]"
                      )}
                    >
                      <div className={cn("transition-all duration-300", showRevealOverlay && "filter blur-md select-none pointer-events-none opacity-20")}>
                        <BlockRenderer block={n.block} style="unruled" />
                      </div>

                      {/* Recall mode overlay with reveal button */}
                      {showRevealOverlay && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/5 backdrop-blur-sm rounded-2xl p-4 border border-dashed border-slate-300/80 z-10">
                          <button
                            onClick={() => handleToggleReveal(n.id)}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-2xl text-xs font-bold shadow-md hover:bg-indigo-700 active:scale-95 transition-all cursor-pointer pointer-events-auto"
                          >
                            <Eye className="h-4 w-4" /> Reveal Answer
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Row: Summary Area */}
      {!revisionMode && (
        <div className="shrink-0 border-t-2 border-slate-800 pt-5 mt-6">
          <div className="text-xs font-black uppercase text-emerald-950 tracking-wider flex items-center gap-1.5 mb-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" /> Summary & Key Takeaways
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/30 p-4 sm:p-5 text-xs sm:text-sm font-medium text-emerald-950 leading-relaxed shadow-sm break-words">
            {summaryItems.length > 0 ? (
              summaryItems.map((s, i) => (
                <p key={i} className="mb-2 last:mb-0 flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>{s}</span>
                </p>
              ))
            ) : (
              <p className="text-slate-500 italic">
                {doc.title}: Key definitions, core concepts, and formulas summarized for quick revision.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
