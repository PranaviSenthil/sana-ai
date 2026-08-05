import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { NotebookDoc, NotebookBlock } from "@/lib/study-notes.schema";
import { BlockRenderer } from "./blocks";
import { Sparkles, Network, ChevronRight, Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";

interface BranchNode {
  id: string;
  title: string;
  kind: string;
  blocks: NotebookBlock[];
}

export function MindMapViewer({ doc }: { doc: NotebookDoc }) {
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Group doc blocks into branches by section or logical category
  const branches = useMemo(() => {
    const nodes: BranchNode[] = [];
    let currentBranch: BranchNode | null = null;
    let bIndex = 1;

    for (const b of doc.blocks) {
      if (b.kind === "section") {
        if (currentBranch) nodes.push(currentBranch);
        currentBranch = {
          id: `branch-${bIndex++}`,
          title: b.text,
          kind: "section",
          blocks: [],
        };
      } else {
        if (!currentBranch) {
          currentBranch = {
            id: `branch-${bIndex++}`,
            title: "Core Concepts",
            kind: "overview",
            blocks: [],
          };
        }
        currentBranch.blocks.push(b);
      }
    }
    if (currentBranch) nodes.push(currentBranch);

    if (nodes.length === 0) {
      nodes.push({
        id: "branch-1",
        title: "Overview",
        kind: "overview",
        blocks: doc.blocks,
      });
    }

    return nodes;
  }, [doc]);

  const [activeBranchId, setActiveBranchId] = useState<string>(
    branches[0]?.id || "branch-1",
  );

  const activeBranch = branches.find((b) => b.id === activeBranchId) || branches[0];

  return (
    <div
      className={cn(
        "no-scrollbar border border-indigo-100 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 sm:p-6 text-white shadow-2xl transition-all duration-300",
        isFullScreen
          ? "fixed inset-0 z-50 overflow-y-auto"
          : "relative w-full max-h-[78vh] overflow-y-auto rounded-3xl"
      )}
    >
      <button
        onClick={() => setIsFullScreen(!isFullScreen)}
        className="absolute right-4 top-4 rounded-xl bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
        title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
      >
        {isFullScreen ? (
          <Minimize className="h-5 w-5" />
        ) : (
          <Maximize className="h-5 w-5" />
        )}
      </button>

      {/* Central Hub Header */}
      <div className="relative mb-6 mt-4 flex flex-col items-center justify-center text-center py-2">
        <div className="absolute top-0 rounded-full bg-indigo-500/20 blur-2xl h-24 w-48 pointer-events-none" />
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-4 py-1 text-xs font-bold uppercase tracking-widest text-indigo-300 backdrop-blur-md mb-2">
          <Network className="h-3.5 w-3.5 text-indigo-400" /> Visual Mind Map
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-purple-200 tracking-tight">
          {doc.title}
        </h2>
      </div>

      {/* Mind Map Interactive Branches Ring */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2.5 px-2">
        {branches.map((branch, i) => {
          const isActive = branch.id === activeBranchId;
          return (
            <motion.button
              key={branch.id}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setActiveBranchId(branch.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-md cursor-pointer border ${
                isActive
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 border-indigo-300 text-white shadow-indigo-500/30 ring-2 ring-indigo-400/40"
                  : "bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-300 hover:text-white"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${
                  isActive ? "bg-white text-indigo-700" : "bg-slate-700 text-slate-300"
                }`}
              >
                {i + 1}
              </span>
              <span>{branch.title}</span>
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  isActive ? "rotate-90 text-white" : "text-slate-400"
                }`}
              />
            </motion.button>
          );
        })}
      </div>

      {/* Selected Branch Content Node Display */}
      <AnimatePresence mode="wait">
        {activeBranch && (
          <motion.div
            key={activeBranch.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-xl backdrop-blur-xl text-slate-900"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <h3 className="text-lg font-bold text-white tracking-wide">
                {activeBranch.title}
              </h3>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-950/80 px-2.5 py-1 rounded-full border border-indigo-800">
                {activeBranch.blocks.length} Concept Nodes
              </span>
            </div>

            {/* Block list rendered inside visual card container */}
            <div className="space-y-3 bg-white/95 rounded-xl p-4 sm:p-5 shadow-inner border border-slate-100">
              {activeBranch.blocks.map((b, i) => (
                <BlockRenderer key={i} block={b} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
