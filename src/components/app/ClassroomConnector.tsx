import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, X, ShieldCheck, Sparkles, Loader2, CheckCircle2, LogOut, RefreshCw, BookOpen, ClipboardList, Megaphone, FileStack } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getClassroomAuthUrl,
  getClassroomConnection,
  disconnectClassroom,
} from "@/lib/classroom.functions";
import { getClassroomSyncSummary } from "@/lib/classroom-sync.functions";
import { ClassroomSyncProgress } from "./ClassroomSyncProgress";
import { toast } from "sonner";

const PERMISSIONS = [
  "Read your Classroom courses and rosters",
  "Read coursework, materials & topics",
  "Read announcements & submissions",
  "Read Drive files opened via Classroom",
  "Read Google Docs and Slides content",
];

export function ClassroomConnectorSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const getAuthUrl = useServerFn(getClassroomAuthUrl);
  const getConn = useServerFn(getClassroomConnection);
  const disconnect = useServerFn(disconnectClassroom);
  const getSummary = useServerFn(getClassroomSyncSummary);
  const [syncOpen, setSyncOpen] = useState(false);

  const { data: conn, isLoading } = useQuery({
    queryKey: ["classroom-connection"],
    queryFn: () => getConn(),
    enabled: open,
    staleTime: 30_000,
  });

  // Reflect callback query params (?classroom=connected|error) once, then clean URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("classroom");
    if (!status) return;
    if (status === "connected") {
      toast.success("Google Classroom connected");
      qc.invalidateQueries({ queryKey: ["classroom-connection"] });
    } else if (status === "error") {
      const reason = url.searchParams.get("reason") ?? "unknown";
      toast.error(`Couldn't connect Classroom: ${reason.replace(/_/g, " ")}`);
    }
    url.searchParams.delete("classroom");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [qc]);

  async function handleConnect() {
    try {
      const { url } = await getAuthUrl({ data: { origin: window.location.origin } });
      window.location.href = url;
    } catch (e) {
      console.error(e);
      toast.error("Couldn't start Google sign-in");
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect();
      toast.success("Google Classroom disconnected");
      qc.invalidateQueries({ queryKey: ["classroom-connection"] });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't disconnect");
    }
  }

  const connected = !!conn?.connected;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="classroom-sheet-title"
            className={cn(
              "fixed z-[101] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "w-[min(440px,calc(100vw-24px))] max-h-[92vh] overflow-y-auto",
              "rounded-3xl bg-background shadow-2xl border border-border/50",
            )}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            {/* Hero */}
            <div className="relative p-6 pb-4 bg-gradient-to-br from-warning/15 via-primary/10 to-transparent rounded-t-3xl">
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-warning/15 flex items-center justify-center">
                  <GraduationCap className="h-6 w-6 text-warning" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="classroom-sheet-title" className="text-lg font-semibold leading-tight">
                    Google Classroom
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Turn every class, assignment and doc into AI-searchable knowledge.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : connected ? (
                <ConnectedView
                  email={conn?.email ?? undefined}
                  name={conn?.name ?? undefined}
                  picture={conn?.picture ?? undefined}
                  lastSyncAt={conn?.last_sync_at ?? undefined}
                  onDisconnect={handleDisconnect}
                  onSync={() => setSyncOpen(true)}
                  getSummary={getSummary}
                />
              ) : (
                <DisconnectedView onConnect={handleConnect} />
              )}
            </div>
          </motion.div>
          <ClassroomSyncProgress
            open={syncOpen}
            onClose={() => setSyncOpen(false)}
          />
        </>
      )}
    </AnimatePresence>
  );
}

function DisconnectedView({ onConnect }: { onConnect: () => void }) {
  return (
    <>
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            Sana will request the minimum read-only scopes. We never post, edit, or delete anything
            in your Classroom or Drive.
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Permissions we'll request
        </div>
        <ul className="space-y-1.5">
          {PERMISSIONS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onConnect}
        className={cn(
          "w-full flex items-center justify-center gap-2.5 rounded-2xl py-3 px-4",
          "bg-foreground text-background font-medium text-sm",
          "hover:opacity-90 active:scale-[0.99] transition",
          "shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        )}
      >
        <GoogleG className="h-4 w-4" />
        Sign in with Google
      </button>
      <p className="text-[11px] text-muted-foreground text-center">
        You'll be redirected to Google's secure sign-in page.
      </p>
    </>
  );
}

function ConnectedView({
  email, name, picture, lastSyncAt, onDisconnect, onSync, getSummary,
}: {
  email?: string;
  name?: string;
  picture?: string;
  lastSyncAt?: string;
  onDisconnect: () => void;
  onSync: () => void;
  getSummary: () => Promise<{ courses: number; coursework: number; announcements: number; materials: number }>;
}) {
  const [imgError, setImgError] = useState(false);
  const { data: summary } = useQuery({
    queryKey: ["classroom-sync-summary"],
    queryFn: () => getSummary(),
    staleTime: 30_000,
  });

  const stats = [
    { icon: BookOpen, label: "Courses", value: summary?.courses ?? 0 },
    { icon: ClipboardList, label: "Assignments", value: summary?.coursework ?? 0 },
    { icon: Megaphone, label: "Announcements", value: summary?.announcements ?? 0 },
    { icon: FileStack, label: "Materials", value: summary?.materials ?? 0 },
  ];

  return (
    <>
      <div className="rounded-2xl border border-border/60 p-3 flex items-center gap-3">
        {picture && !imgError ? (
          <img
            src={picture}
            alt={name ? `${name}'s profile picture` : "User profile picture"}
            className="h-10 w-10 rounded-full"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{name ?? "Connected"}</div>
          <div className="text-xs text-muted-foreground truncate">{email ?? ""}</div>
        </div>
        <div className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Live
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-2xl border border-border/60 p-3 flex items-center gap-2.5"
            >
              <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-none">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-primary/5 border border-primary/10 p-3 text-xs text-muted-foreground">
        {lastSyncAt
          ? `Last sync ${new Date(lastSyncAt).toLocaleString()}`
          : "No sync yet — run one to pull your Classroom data into Sana."}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onSync}
          className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-3 text-xs font-medium bg-foreground text-background hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Sync
        </button>
        <a
          href="/classroom"
          className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-3 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Hub
        </a>
        <button
          onClick={onDisconnect}
          className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-3 text-xs font-medium border border-border/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Leave
        </button>
      </div>
    </>
  );
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
