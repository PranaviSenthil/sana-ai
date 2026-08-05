import { useMemo, useState, useId } from "react";
import type { NotebookDoc, NotebookBlock } from "@/lib/study-notes.schema";
import { BlockRenderer } from "./blocks";
import { BookOpen, Key, FileText, CheckCircle2, Bookmark, Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";

export function CornellViewer({ doc }: { doc: NotebookDoc }) {
  const componentId = useId();
  const [activeTab, setActiveTab] = useState<"all" | "cues" | "notes">("all");
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [highlightedBlock, setHighlightedBlock] = useState<string | null>(null);

  // Extract cues, main notes, and summaries cleanly
  const { cues, notes, summaryItems } = useMemo(() => {
    const cuesList: { id: string; text: string }[] = [];
    const mainNotes: { id: string; block: NotebookBlock }[] = [];
    const summaries: string[] = [];
    let idCounter = 0;

    for (const b of doc.blocks) {
      if (!b) continue;
      // Using componentId ensures IDs are unique across multiple CornellViewers in the chat
      const id = `cornell-block-${componentId}-${idCounter++}`.replace(/:/g, '');
      
      if (b.kind === "section") {
        if (b.text) cuesList.push({ id, text: b.text });
        mainNotes.push({ id, block: b });
      } else if (b.kind === "definition") {
        if (b.term) cuesList.push({ id, text: `Def: ${b.term}` });
        mainNotes.push({ id, block: b });
      } else if (b.kind === "formula") {
        if (b.label) cuesList.push({ id, text: `Eq: ${b.label}` });
        mainNotes.push({ id, block: b });
      } else if (b.kind === "summary") {
        if (b.text) summaries.push(b.text);
      } else if (b.kind === "revision" || b.kind === "checklist") {
        if (b.items?.length) cuesList.push(...b.items.slice(0, 2).map((text) => ({ id, text })));
        mainNotes.push({ id, block: b });
      } else {
        mainNotes.push({ id, block: b });
      }
    }

    return { cues: cuesList, notes: mainNotes, summaryItems: summaries };
  }, [doc]);

  const scrollToBlock = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedBlock(id);
      setTimeout(() => setHighlightedBlock(null), 2000);
      
      // Also switch to notes tab on mobile if in cues tab
      if (activeTab === "cues") {
        setActiveTab("notes");
      }
    }
  };

  return (
    <div
      className={cn(
        "no-scrollbar border-2 border-slate-800 bg-[#FFFDF9] p-4 sm:p-6 text-slate-800 flex flex-col justify-between transition-all duration-300",
        isFullScreen
          ? "fixed inset-0 z-50 overflow-y-auto"
          : "relative w-full max-h-[78vh] overflow-y-auto rounded-2xl shadow-2xl"
      )}
    >
      {/* Header Bar */}
      <div className="shrink-0 border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
          <div className="flex items-center gap-1.5 truncate">
            <Bookmark className="h-4 w-4 text-purple-700 shrink-0" />
            <span>Subject:</span>
            <span className="text-slate-900 font-extrabold truncate max-w-[200px] sm:max-w-none">
              {doc.title}
            </span>
          </div>
          <div className="hidden sm:block text-purple-800 font-black tracking-widest bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-300">
            CORNELL NOTES
          </div>
          <div className="flex items-center gap-2">
            <div>
              Date: <span className="text-slate-900">{new Date().toLocaleDateString()}</span>
            </div>
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="rounded-xl border border-slate-300 bg-white p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 ml-2 cursor-pointer shadow-sm"
              title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullScreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Filter Tabs */}
        <div className="mt-3 flex sm:hidden items-center gap-2">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "all"
                ? "bg-slate-900 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            All Notes
          </button>
          <button
            onClick={() => setActiveTab("cues")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "cues"
                ? "bg-purple-700 text-white"
                : "bg-purple-100 text-purple-800"
            }`}
          >
            Keywords ({cues.length})
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "notes"
                ? "bg-indigo-700 text-white"
                : "bg-indigo-100 text-indigo-800"
            }`}
          >
            Notes ({notes.length})
          </button>
        </div>
      </div>

      {/* Main Cornell Split Body */}
      <div className="grow grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 min-h-[380px] pb-6 border-b-2 border-slate-800">
        {/* Left Column: Cues & Keywords */}
        <div
          className={`${
            activeTab === "notes" ? "hidden md:block" : "block"
          } space-y-3 bg-purple-50/50 p-4 rounded-xl border border-purple-200/70 max-h-[600px] overflow-y-auto no-scrollbar`}
        >
          <div className="text-xs font-black uppercase text-purple-900 tracking-wider flex items-center gap-1.5 border-b border-purple-200 pb-2">
            <Key className="h-3.5 w-3.5 text-purple-700" /> Cues & Keywords
          </div>
          <ul className="space-y-2 text-xs font-medium">
            {cues.map((cue, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => scrollToBlock(cue.id)}
                  className="w-full text-left rounded-lg bg-white p-2.5 border border-purple-200/80 shadow-2xs font-bold text-purple-950 leading-snug break-words flex items-start gap-2 hover:bg-purple-100 transition-colors cursor-pointer"
                >
                  <span className="text-purple-600 font-extrabold text-sm leading-none">•</span>
                  <span>{cue.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Column: Main Notes */}
        <div
          className={`${
            activeTab === "cues" ? "hidden md:block" : "block"
          } space-y-6 pt-2 md:pl-2 overflow-y-auto no-scrollbar max-h-[600px] scroll-smooth`}
        >
          <div className="text-xs font-black uppercase text-slate-700 tracking-wider border-b border-slate-300 pb-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-slate-700" /> Main Notes & Explanations
          </div>
          <div className="space-y-6">
            {notes.map((item, i) => (
              <div 
                key={i} 
                id={item.id}
                className={cn(
                  "relative pt-1 transition-all duration-500 rounded-xl",
                  highlightedBlock === item.id ? "ring-2 ring-purple-400 bg-purple-50/50 p-3 -mx-3" : ""
                )}
              >
                <BlockRenderer block={item.block} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: Summary Box */}
      <div className="shrink-0 pt-4 mt-2">
        <div className="text-xs font-black uppercase text-emerald-900 tracking-wider flex items-center gap-1.5 mb-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700" /> Summary & Key Takeaways
        </div>
        <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50/70 p-4 text-xs sm:text-sm font-medium text-emerald-950 leading-relaxed shadow-2xs break-words">
          {summaryItems.length > 0 ? (
            summaryItems.map((s, i) => (
              <p key={i} className="mb-1.5 last:mb-0">
                • {s}
              </p>
            ))
          ) : (
            <p>
              {doc.title}: Key definitions, core concepts, and formulas summarized for quick revision.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
