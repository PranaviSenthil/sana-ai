import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TopBar } from "@/components/app/TopBar";
import { listReminders, deleteReminder, updateReminderStatus } from "@/lib/reminders.functions";
import { ArrowLeft, Phone, Plus, Repeat, Trash2, CheckCheck, Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { triggerIncomingWebCall } from "@/hooks/use-web-call-reminder";

export const Route = createFileRoute("/_authenticated/ai-calls")({
  head: () => ({
    meta: [
      { title: "Upcoming AI Calls — Sana" },
      { name: "description", content: "All your scheduled AI study calls with Sana." },
    ],
  }),
  component: AICallsPage,
});

type ReminderItem = {
  id: string; title: string; scheduled_at: string; type: string;
  repeat_mode: string; status: string; duration_minutes: number;
};

function AICallsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listReminders);
  const del = useServerFn(deleteReminder);
  const setStatus = useServerFn(updateReminderStatus);

  const { data: reminders = [] } = useQuery<ReminderItem[]>({
    queryKey: ["reminders"],
    queryFn: () => list() as never,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }) as unknown as Promise<unknown>,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reminders"] }); toast.success("Call cancelled"); },
  });
  const doneMut = useMutation({
    mutationFn: (id: string) => setStatus({ data: { id, status: "done" } }) as unknown as Promise<unknown>,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reminders"] }); toast.success("Marked as done"); },
  });

  const now = Date.now();
  const upcoming = reminders
    .filter((r) => r.status !== "done" && new Date(r.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const past = reminders
    .filter((r) => r.status === "done" || new Date(r.scheduled_at).getTime() <= now)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  const groups = groupByDay(upcoming);

  const handleTestWebCall = () => {
    triggerIncomingWebCall({
      reminderTitle: upcoming[0]?.title || "DBMS Functions & Modules Revision",
      topic: "Python & DBMS Architecture",
      userName: "",
      persona: "friendly_coach",
    });
  };

  return (
    <div className="pb-6">
      <TopBar
        title={<span className="inline-flex items-center gap-2"><Phone className="h-4 w-4 text-primary" /> Upcoming AI Calls</span>}
        subtitle={`${upcoming.length} scheduled`}
      />
      <div className="mx-5 -mt-2">
        <button onClick={() => nav({ to: "/home" })} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      </div>


      <section className="mx-5 mt-2 space-y-2">
        <button
          onClick={handleTestWebCall}
          className="gradient-primary shadow-soft flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-primary-foreground animate-pulse"
        >
          <Sparkles className="h-4 w-4" /> Simulate Incoming Web Call (Test Now)
        </button>
        <Link to="/voice-call/new" className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-lavender text-xs font-semibold text-primary">
          <Phone className="h-4 w-4" /> Schedule AI Voice Call
        </Link>
        <Link to="/reminder" className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-xs font-semibold text-foreground">
          <Plus className="h-3.5 w-3.5" /> Basic reminder
        </Link>
      </section>

      {upcoming.length === 0 ? (
        <section className="mx-5 mt-4 rounded-[24px] border border-dashed border-border bg-card p-8 text-center shadow-card">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-lavender text-primary">
            <Phone className="h-6 w-6" />
          </div>
          <div className="mt-3 text-sm font-bold">No upcoming AI calls</div>
          <p className="mt-1 text-xs text-muted-foreground">Schedule one and Sana will call you at the right time.</p>
        </section>
      ) : (
        <section className="mx-5 mt-4 space-y-5">
          {groups.map(([day, items]) => (
            <div key={day}>
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{day}</div>
                <div className="text-[10px] font-semibold text-muted-foreground">{items.length} call{items.length === 1 ? "" : "s"}</div>
              </div>
              <ul className="space-y-2">
                {items.map((r) => (
                  <CallCard
                    key={r.id}
                    r={r}
                    onDone={() => doneMut.mutate(r.id)}
                    onDelete={() => deleteMut.mutate(r.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="mx-5 mt-6">
          <div className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Past</div>
          <ul className="space-y-2">
            {past.slice(0, 10).map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 opacity-70">
                <div className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                  r.status === "done" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                )}>
                  <Phone className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(r.scheduled_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  r.status === "done" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                )}>
                  {r.status === "done" ? "Done" : "Missed"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CallCard({ r, onDone, onDelete }: { r: ReminderItem; onDone: () => void; onDelete: () => void }) {
  const at = new Date(r.scheduled_at);
  return (
    <li className="shadow-card flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lavender text-primary">
        <div className="text-center leading-tight">
          <div className="text-xs font-bold">{at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).split(" ")[0]}</div>
          <div className="text-[9px] font-bold">{at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).split(" ")[1] ?? ""}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{r.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" /> {r.duration_minutes}m</span>
          {r.repeat_mode !== "once" && (
            <span className="inline-flex items-center gap-0.5 capitalize"><Repeat className="h-3 w-3" /> {r.repeat_mode}</span>
          )}
          <span className="rounded-full bg-lavender px-1.5 py-0.5 font-bold text-primary">{formatIn(r.scheduled_at)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button onClick={onDone} className="grid h-8 w-8 place-items-center rounded-full bg-success/10 text-success" aria-label="Mark done">
          <CheckCheck className="h-4 w-4" />
        </button>
        <button onClick={onDelete} className="grid h-8 w-8 place-items-center rounded-full bg-destructive/10 text-destructive" aria-label="Cancel">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function groupByDay(items: ReminderItem[]): [string, ReminderItem[]][] {
  const map = new Map<string, ReminderItem[]>();
  for (const r of items) {
    const d = new Date(r.scheduled_at);
    const key = dayLabel(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries());
}

function dayLabel(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatIn(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}
