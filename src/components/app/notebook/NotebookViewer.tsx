import { useMemo, useState, useRef, useEffect } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, BookOpen, Check, ChevronDown } from "lucide-react";
import { STYLE_META, type NotebookDoc, type StudyStyleT } from "@/lib/study-notes.schema";
import { paginateNotebook, extractSections } from "./paginate";
import { BlockRenderer } from "./blocks";
import { CornellViewer } from "./CornellViewer";
import { MindMapViewer } from "./MindMapViewer";
import { useQueryClient } from "@tanstack/react-query";
import { setStudyPrefs } from "@/lib/study-notes.functions";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";

// Custom Dropdown Style Selector Component
function NotebookStyleSelector({
  active,
  onChange,
}: {
  active: StudyStyleT;
  onChange: (s: StudyStyleT) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const options = [
    { id: "book", label: "Book", icon: "📖", desc: "Textbook Style" },
    { id: "ruled", label: "Ruled", icon: "📓", desc: "Handwritten Note" },
    { id: "unruled", label: "Unruled", icon: "📄", desc: "Modern Workspace" },
    { id: "cornell", label: "Cornell", icon: "📋", desc: "Active Recall" },
    { id: "mindmap", label: "Mind Map", icon: "🕸️", desc: "Visual Map" },
  ] as const;

  const currentOpt = options.find((o) => o.id === active) || options[1];

  return (
    <div className="mb-4 flex items-center justify-between border-b border-slate-200/50 pb-3">
      <div className="text-left flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <BookOpen className="h-3.5 w-3.5 text-slate-450 shrink-0" />
        <span>Study Notebook</span>
      </div>
      
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-3xs transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span role="img" aria-hidden="true" className="text-sm shrink-0">
            {currentOpt.icon}
          </span>
          <span>Style: {currentOpt.label}</span>
          <ChevronDown
            className={cn("h-3 w-3 text-slate-400 transition-transform duration-200 shrink-0", menuOpen && "rotate-180")}
          />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <>
              {/* Overlay sheet to capture clicks safely outside the popover */}
              <div className="fixed inset-0 z-[120]" onClick={() => setMenuOpen(false)} />
              
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-2xl shadow-lg py-1.5 z-[130] origin-top-right"
              >
                {options.map((opt) => {
                  const isActive = active === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChange(opt.id);
                        setMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-bold transition-colors cursor-pointer",
                        isActive
                          ? "bg-indigo-50 text-indigo-750 font-extrabold"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span role="img" aria-hidden="true" className="text-sm shrink-0">
                          {opt.icon}
                        </span>
                        <span>{opt.label}</span>
                      </span>
                      {isActive && <Check className="h-3.5 w-3.5 text-indigo-650 shrink-0" />}
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function NotebookViewerSkeleton() {
  return (
    <div className="notebook-page notebook-ruled min-h-[480px]">
      <div className="notebook-holes" aria-hidden />
      <div className="relative flex flex-col items-center justify-center gap-3 py-24 text-[#6d28d9]/80">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="font-handwriting text-sm">Sana is preparing your study notes…</div>
      </div>
    </div>
  );
}

export function NotebookViewer({
  doc,
  style = "ruled",
}: {
  doc: NotebookDoc;
  style?: StudyStyleT;
}) {
  const qc = useQueryClient();
  const setPrefs = useServerFn(setStudyPrefs);

  // Initialize selected style from localStorage fallback or prop style
  const [currentStyle, setCurrentStyle] = useState<StudyStyleT>(() => {
    try {
      const saved = localStorage.getItem("sana_pref_study_style");
      if (saved) return saved as StudyStyleT;
    } catch {}
    return style;
  });

  // Sync state if style prop updates from query
  useEffect(() => {
    setCurrentStyle(style);
  }, [style]);

  const handleStyleChange = async (newStyle: StudyStyleT) => {
    setCurrentStyle(newStyle);
    try {
      localStorage.setItem("sana_pref_study_style", newStyle);
      await setPrefs({ data: { style: newStyle, enabled: true } });
      qc.invalidateQueries({ queryKey: ["study-prefs"] });
    } catch (e) {
      console.warn("Failed to persist study style preference:", e);
    }
  };

  const pages = useMemo(() => paginateNotebook(doc), [doc]);
  const sections = useMemo(() => extractSections(pages), [pages]);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const total = pages.length;

  const safeIdx = Math.max(0, Math.min(total - 1, idx));

  const go = (n: number) => {
    const next = Math.max(0, Math.min(total - 1, n));
    if (next === safeIdx) return;
    setDir(next > safeIdx ? 1 : -1);
    setIdx(next);
  };

  const dateStr = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement && el.contains(document.activeElement)) {
        if (e.key === "ArrowRight") go(safeIdx + 1);
        if (e.key === "ArrowLeft") go(safeIdx - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) go(safeIdx + 1);
    else if (info.offset.x > 60 || info.velocity.x > 400) go(safeIdx - 1);
  };

  const currentPageBlocks = pages[safeIdx] || [];

  // Style-specific layout config
  const pageStyleClass = useMemo(() => {
    if (currentStyle === "unruled") {
      return "bg-white border border-slate-200 shadow-sm rounded-3xl p-6 sm:p-8 text-slate-800 font-sans";
    }
    if (currentStyle === "book") {
      return "bg-[#FAF6EE] border border-[#EBE3D5] shadow-md rounded-2xl p-8 sm:p-12 font-serif text-slate-900 mx-auto max-w-2xl leading-relaxed";
    }
    // Default: ruled paper
    return "notebook-page notebook-ruled shadow-card min-h-[520px] font-handwriting";
  }, [currentStyle]);

  // Render specialised layouts directly
  if (currentStyle === "cornell") {
    return (
      <div className="w-full">
        <NotebookStyleSelector active={currentStyle} onChange={handleStyleChange} />
        <CornellViewer doc={doc} />
      </div>
    );
  }

  if (currentStyle === "mindmap") {
    return (
      <div className="w-full">
        <NotebookStyleSelector active={currentStyle} onChange={handleStyleChange} />
        <MindMapViewer doc={doc} />
      </div>
    );
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="relative select-none w-full focus-visible:outline-none">
      {/* 1. Style Selector Component */}
      <NotebookStyleSelector active={currentStyle} onChange={handleStyleChange} />

      {/* 2. Title Header */}
      <div className="mb-5 px-2 text-center mt-2 flex flex-col items-center">
        <h1
          className={cn(
            "transition-all",
            currentStyle === "book"
              ? "font-serif text-3xl font-black text-slate-900 tracking-tight"
              : currentStyle === "unruled"
                ? "font-sans text-2xl font-black text-slate-900 tracking-tight"
                : "font-handwriting-bold text-[30px] leading-tight text-black underline underline-offset-4 decoration-[2px]"
          )}
        >
          {doc.title}
        </h1>
        {doc.subtitle && (
          <div className={cn(
            "mt-1 text-[14px]",
            currentStyle === "book" ? "font-serif text-slate-500 italic" : "font-handwriting text-[#64748b]"
          )}>
            {doc.subtitle}
          </div>
        )}
      </div>

      {/* 3. Page Stack Article */}
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.article
            key={safeIdx}
            custom={dir}
            initial={{ opacity: 0, x: dir * 80, rotateY: dir * -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
            exit={{ opacity: 0, x: dir * -80, rotateY: dir * 10, scale: 0.95 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={onDragEnd}
            className={cn(pageStyleClass, "min-h-[520px] touch-pan-y relative")}
          >
            {currentStyle === "ruled" && <div className="notebook-holes" aria-hidden />}
            <div className={cn(
              "absolute top-3 right-4 text-xs font-semibold",
              currentStyle === "book" ? "font-sans text-slate-400" : "font-handwriting text-slate-500"
            )}>
              {dateStr}
            </div>
            
            <div className="notebook-body pt-6">
              {/* Auto-TOC for large notebooks on page 1 */}
              {safeIdx === 0 && total > 4 && sections.length > 1 && (
                <div className={cn(
                  "mb-6 rounded-2xl border p-4 shadow-3xs",
                  currentStyle === "book"
                    ? "border-slate-200 bg-slate-50/60 font-serif"
                    : currentStyle === "unruled"
                      ? "border-slate-100 bg-slate-50/50 font-sans"
                      : "border-dashed border-slate-300 bg-white/60 font-handwriting"
                )}>
                  <h3 className={cn(
                    "mb-3 font-bold",
                    currentStyle === "book"
                      ? "text-[16px] text-slate-900"
                      : currentStyle === "unruled"
                        ? "text-[14px] text-slate-800"
                        : "text-[18px] text-[#4c1d95]"
                  )}>
                    Table of Contents
                  </h3>
                  <ul className="space-y-2">
                    {sections.map((s) => (
                      <li key={s.index}>
                        <button
                          type="button"
                          onClick={() => go(s.index)}
                          className={cn(
                            "flex w-full items-center gap-3 text-left hover:text-indigo-600 transition-colors cursor-pointer",
                            currentStyle === "book" ? "text-slate-800 font-serif text-[14.5px]" : "text-slate-700 text-xs"
                          )}
                        >
                          <span className={cn(
                            "font-bold",
                            currentStyle === "book" ? "text-slate-400 font-sans" : "text-slate-400"
                          )}>
                            Pg.{s.index + 1}
                          </span>
                          <span className="border-b border-dotted border-slate-350 flex-1 truncate">
                            {s.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="space-y-4">
                {currentPageBlocks.map((b, i) => (
                  <BlockRenderer key={i} block={b} style={currentStyle} />
                ))}
              </div>
            </div>
            
            <div className={cn(
              "font-bold text-[14px] text-right mt-6",
              currentStyle === "book" ? "font-serif text-slate-400" : "font-handwriting text-slate-700"
            )}>
              {safeIdx + 1} / {total}
            </div>
          </motion.article>
        </AnimatePresence>
      </div>

      {/* 4. Page Navigation Controls */}
      <div className="mt-5 flex flex-col items-center gap-3">
        <div className="flex items-center gap-4 bg-card border border-border px-4 py-2 rounded-2xl shadow-xs">
          <button
            type="button"
            onClick={() => go(safeIdx - 1)}
            disabled={safeIdx === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-muted hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-muted-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          
          <span className="text-xs font-bold text-muted-foreground px-2">
            Page {safeIdx + 1} of {total}
          </span>

          <button
            type="button"
            onClick={() => go(safeIdx + 1)}
            disabled={safeIdx >= total - 1}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-40 disabled:hover:bg-primary cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Page Thumbnails */}
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar max-w-full px-2 py-1">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to page ${i + 1}`}
              className="flex flex-col items-center gap-1 group cursor-pointer focus-visible:outline-none"
            >
              <div
                className={cn(
                  "w-12 h-9 rounded border flex items-center justify-center overflow-hidden transition-all",
                  i === safeIdx
                    ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs scale-105"
                    : "border-slate-200 opacity-60 group-hover:opacity-100"
                )}
              >
                <div className="w-full h-full relative bg-[#FEFEF6]">
                  <div className="absolute top-0 bottom-0 left-1 w-0.5 bg-red-400/30" />
                  <div className="absolute top-2 left-0 right-0 h-px bg-indigo-400/10" />
                  <div className="absolute top-4 left-0 right-0 h-px bg-indigo-400/10" />
                  <div className="absolute top-6 left-0 right-0 h-px bg-indigo-400/10" />
                </div>
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold",
                  i === safeIdx ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-650"
                )}
              >
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
