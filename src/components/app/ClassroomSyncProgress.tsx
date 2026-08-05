import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, AlertCircle, BookOpen, ClipboardList, Megaphone, FileStack, Search, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  syncClassroomCourses,
  syncClassroomCoursework,
  syncClassroomAnnouncements,
  syncClassroomMaterials,
  finalizeClassroomSync,
} from "@/lib/classroom-sync.functions";
import {
  discoverClassroomDocuments,
  indexNextClassroomDocuments,
} from "@/lib/classroom-index.functions";

type StepId = "courses" | "coursework" | "announcements" | "materials" | "discover" | "index";
type Status = "pending" | "running" | "done" | "error";

type StepState = {
  id: StepId;
  label: string;
  icon: typeof BookOpen;
  status: Status;
  count?: number;
  progress?: { current: number; total: number };
  error?: string;
};

const INITIAL: StepState[] = [
  { id: "courses", label: "Fetching your courses", icon: BookOpen, status: "pending" },
  { id: "coursework", label: "Syncing assignments", icon: ClipboardList, status: "pending" },
  { id: "announcements", label: "Loading announcements", icon: Megaphone, status: "pending" },
  { id: "materials", label: "Syncing class materials", icon: FileStack, status: "pending" },
  { id: "discover", label: "Discovering documents", icon: Search, status: "pending" },
  { id: "index", label: "Indexing with AI embeddings", icon: Sparkles, status: "pending" },
];

export function ClassroomSyncProgress({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const qc = useQueryClient();
  const runCourses = useServerFn(syncClassroomCourses);
  const runCoursework = useServerFn(syncClassroomCoursework);
  const runAnnouncements = useServerFn(syncClassroomAnnouncements);
  const runMaterials = useServerFn(syncClassroomMaterials);
  const finalize = useServerFn(finalizeClassroomSync);
  const discover = useServerFn(discoverClassroomDocuments);
  const indexNext = useServerFn(indexNextClassroomDocuments);

  const [steps, setSteps] = useState<StepState[]>(INITIAL);
  const [done, setDone] = useState(false);
  const [errorDetails, setErrorDetails] = useState<{ step: string; message: string } | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setSteps(INITIAL);
      setDone(false);
      setErrorDetails(null);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const patch = (id: StepId, next: Partial<StepState>) =>
        setSteps((s) => s.map((st) => (st.id === id ? { ...st, ...next } : st)));

      let courseIds: string[] = [];
      let hadError: string | null = null;

      try {
        patch("courses", { status: "running" });
        const c = await runCourses();
        courseIds = c.courseIds;
        patch("courses", { status: "done", count: c.count });

        patch("coursework", { status: "running" });
        const cw = await runCoursework({ data: { courseIds } });
        patch("coursework", { status: "done", count: cw.count });

        patch("announcements", { status: "running" });
        const an = await runAnnouncements({ data: { courseIds } });
        patch("announcements", { status: "done", count: an.count });

        patch("materials", { status: "running" });
        const m = await runMaterials({ data: { courseIds } });
        patch("materials", { status: "done", count: m.count });

        patch("discover", { status: "running" });
        const d = await discover({ data: { courseIds } });
        patch("discover", { status: "done", count: d.discovered });

        patch("index", { status: "running", progress: { current: 0, total: 0 } });
        let totalProcessed = 0;
        let firstRemaining: number | null = null;
        // Loop until no pending docs remain (safety cap to avoid runaway loops).
        for (let i = 0; i < 200; i++) {
          const step = await indexNext();
          totalProcessed += step.processed;
          if (firstRemaining === null) {
            firstRemaining = totalProcessed + step.remaining;
          }
          patch("index", {
            status: "running",
            progress: { current: totalProcessed, total: Math.max(firstRemaining, totalProcessed) },
          });
          if (step.processed === 0 || step.remaining === 0) break;
        }
        patch("index", {
          status: "done",
          count: totalProcessed,
          progress: { current: totalProcessed, total: totalProcessed },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sync failed";
        hadError = msg;
        const activeStep = steps.find((s) => s.status === "running");
        const stepName = activeStep ? activeStep.label : "Google Classroom Sync";
        setErrorDetails({ step: stepName, message: msg });
        setSteps((s) =>
          s.map((st) =>
            st.status === "running" ? { ...st, status: "error", error: msg } : st,
          ),
        );
        toast.error(msg);
      }

      try {
        await finalize({ data: { error: hadError } });
      } catch {
        // ignore finalize errors — sync itself succeeded
      }

      qc.invalidateQueries({ queryKey: ["classroom-connection"] });
      qc.invalidateQueries({ queryKey: ["classroom-sync-summary"] });
      qc.invalidateQueries({ queryKey: ["classroom-index-stats"] });
      setDone(true);
      if (!hadError) {
        toast.success("Google Classroom synced & indexed");
        onComplete?.();
      }
    })();
  }, [open, runCourses, runCoursework, runAnnouncements, runMaterials, discover, indexNext, finalize, qc, onComplete]);


  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="classroom-sync-title"
            className={cn(
              "fixed z-[111] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "w-[min(420px,calc(100vw-24px))] rounded-3xl bg-background border border-border/60 shadow-2xl overflow-hidden",
            )}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <div className="p-5 bg-gradient-to-br from-primary/15 via-warning/10 to-transparent">
              <h2 id="classroom-sync-title" className="text-base font-semibold">
                Syncing Google Classroom
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Pulling courses, assignments, announcements & materials into Sana.
              </p>
            </div>

            <ol className="p-4 space-y-2">
              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} index={i} />
              ))}
            </ol>

            {errorDetails && (
              <div className="mx-4 my-2 p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-left">
                <div className="text-xs font-black uppercase text-destructive tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Google Classroom Sync Failed</span>
                </div>
                <div className="mt-2 text-xs text-foreground font-semibold">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Step</span>
                  <span>{errorDetails.step}</span>
                </div>
                <div className="mt-2 text-xs text-foreground break-words font-mono bg-destructive/5 border border-destructive/10 p-2 rounded-xl">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider font-sans mb-0.5">Error</span>
                  <span>{errorDetails.message}</span>
                </div>
                <div className="mt-3 text-xs font-bold text-destructive">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider font-sans mb-1 text-slate-500">Suggested Action</span>
                  <span>Please reconnect your Google Account and try again.</span>
                </div>
              </div>
            )}

            <div className="p-4 pt-2 flex justify-end">
              <button
                onClick={onClose}
                disabled={!done}
                className={cn(
                  "rounded-2xl px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  done
                    ? "bg-foreground text-background hover:opacity-90 active:scale-[0.99]"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                {done ? "Done" : "Working…"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function StepRow({ step, index }: { step: StepState; index: number }) {
  const Icon = step.icon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3",
        step.status === "running" && "border-primary/40 bg-primary/5",
        step.status === "done" && "border-emerald-500/30 bg-emerald-500/5",
        step.status === "error" && "border-destructive/40 bg-destructive/5",
        step.status === "pending" && "border-border/60",
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
          step.status === "done" && "bg-emerald-500/15 text-emerald-600",
          step.status === "running" && "bg-primary/15 text-primary",
          step.status === "error" && "bg-destructive/15 text-destructive",
          step.status === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{step.label}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {step.status === "running"
            ? step.progress && step.progress.total > 0
              ? `${step.progress.current} of ${step.progress.total}`
              : "In progress…"
            : step.status === "done"
            ? `${step.count ?? 0} ${step.id === "index" ? "indexed" : "synced"}`
            : step.status === "error"
            ? step.error ?? "Failed"
            : "Waiting"}
        </div>
        {step.status === "running" && step.progress && step.progress.total > 0 && (
          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{
                width: `${Math.min(100, (step.progress.current / step.progress.total) * 100)}%`,
              }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        )}
      </div>
      <div className="shrink-0">
        {step.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
        {step.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
        {step.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />}
      </div>
    </motion.li>
  );
}
