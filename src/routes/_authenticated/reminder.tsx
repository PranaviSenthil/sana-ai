import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  BookOpen,
  Coffee,
  RefreshCw,
  Bell,
  Info,
  Phone,
  CheckCircle2,
  VolumeX,
  PhoneCall,
  Target,
  Lightbulb,
  Repeat,
  Quote,
  Shield,
  Check,
  Pencil,
  ChevronDown,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import sanaAvatar from "@/assets/sana-avatar.png";
import { PERSONALITIES, type AiPersonality } from "@/lib/sana";
import { createReminder } from "@/lib/reminders.functions";
import { triggerIncomingWebCall } from "@/hooks/use-web-call-reminder";

export const Route = createFileRoute("/_authenticated/reminder")({
  ssr: false,
  component: AddReminderPage,
});

type ReminderType = "study" | "break" | "revision" | "custom";
type Duration = 25 | 50 | 75 | 90;
type RepeatMode = "once" | "daily" | "weekly" | "custom";

const ALERT_OPTIONS = [5, 10, 15, 30, 60];

function toLocalInput(d: Date) {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function AddReminderPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useServerFn(createReminder);

  const defaultWhen = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setSeconds(0, 0);
    return toLocalInput(d);
  }, []);

  const [title, setTitle] = useState("Functions & Modules Revision");
  const [type, setType] = useState<ReminderType>("study");
  const [when, setWhen] = useState(defaultWhen);
  const [duration, setDuration] = useState<Duration>(25);
  const [persona, setPersona] = useState<AiPersonality>("friendly_coach");
  const [dontMiss, setDontMiss] = useState(true);
  const [repeat, setRepeat] = useState<RepeatMode>("once");
  const [alertBefore, setAlertBefore] = useState<number>(10);
  const [quote, setQuote] = useState("");
  const [strict, setStrict] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      return create({
        data: {
          title: title.trim(),
          type,
          scheduled_at: new Date(when).toISOString(),
          duration_minutes: duration,
          persona,
          repeat_mode: repeat,
          alert_before_minutes: alertBefore,
          quote: quote || null,
          strict_mode: strict,
          dont_miss: dontMiss,
          ai_call: true,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      toast.success("Reminder set! Sana will keep you on track.");
      router.navigate({ to: "/home" });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not save reminder");
    },
  });


  const types: { id: ReminderType; label: string; Icon: typeof BookOpen }[] = [
    { id: "study", label: "Study Session", Icon: BookOpen },
    { id: "break", label: "Break", Icon: Coffee },
    { id: "revision", label: "Revision", Icon: RefreshCw },
    { id: "custom", label: "Custom", Icon: Bell },
  ];

  const durations: Duration[] = [25, 50, 75, 90];

  return (
    <div className="pb-28">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button
          onClick={() => router.history.back()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-card shadow-card"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lavender">
          <CalendarDays className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-extrabold leading-tight">Add Reminder</h1>
          <p className="truncate text-[11px] text-muted-foreground">Stay on track. Your goals are waiting.</p>
        </div>
        <img src={sanaAvatar} alt="Sana" className="h-11 w-11 rounded-full border-2 border-card object-cover shadow-card" />
      </header>

      {/* Title */}
      <Section>
        <Label>Reminder Title</Label>
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 bg-transparent text-sm font-semibold outline-none"
          />
          <BookOpen className="h-4 w-4 text-primary" />
        </div>
      </Section>

      {/* Type */}
      <Section>
        <Label>Type of Reminder</Label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {types.map(({ id, label, Icon }) => {
            const active = type === id;
            return (
              <button
                key={id}
                onClick={() => setType(id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] font-bold transition",
                  active ? "border-primary/40 bg-lavender text-primary" : "border-border bg-card text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Date & Time */}
      <Section>
        <Label>Date &amp; Time</Label>
        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-lavender">
              <CalendarDays className="h-4 w-4 text-primary" />
            </div>
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full bg-transparent text-[13px] font-bold outline-none"
          />
        </div>
      </Section>

      {/* Duration */}
      <Section>
        <Label>
          Duration <span className="font-normal text-muted-foreground">(Pomodoro)</span>
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {durations.map((d) => {
            const active = duration === d;
            return (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={cn(
                  "flex min-w-[70px] items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-[12px] font-bold transition",
                  active ? "border-primary/40 bg-lavender text-primary" : "border-border bg-card",
                )}
              >
                {active && <span>🍅</span>}
                {d} min
              </button>
            );
          })}
          <button className="flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-3 py-2.5 text-[12px] font-bold text-muted-foreground">
            Custom <Pencil className="h-3 w-3" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-lavender p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-[12px] leading-snug">
            <div className="font-bold text-primary">Pomodoro Tip: 25 min focus + 5 min break = 1 session</div>
            <div className="text-muted-foreground">Stay consistent. Small steps lead to big results!</div>
          </div>
        </div>
      </Section>

      {/* AI Agent Call */}
      <div className="mx-4 mt-3 rounded-[22px] border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-extrabold">AI Agent Call</div>
          <button
            onClick={() =>
              triggerIncomingWebCall({
                reminderTitle: title.trim() || "Study Session",
                persona,
                userName: "Sanjai",
              })
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary hover:bg-primary/20 transition"
          >
            <Sparkles className="h-3 w-3" /> Test Web Call Now
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-lavender p-3">
          <img src={sanaAvatar} alt="Sana" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold text-primary">You will receive a call from AI Agent "Sana"</div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Sana will call you in your browser at the reminder time to get you started and keep you accountable.
            </p>
          </div>
          <div className="gradient-primary grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-soft">
            <Phone className="h-5 w-5 fill-white text-white" />
          </div>
        </div>
      </div>

      {/* AI Agent Mode */}
      <Section>
        <Label>AI Agent Mode</Label>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Choose how Sana should guide and support you.</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {PERSONALITIES.map((p) => {
            const active = persona === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPersona(p.id)}
                className={cn(
                  "relative rounded-2xl border p-3 text-left transition",
                  active ? "border-primary/40 bg-lavender" : "border-border bg-card",
                )}
              >
                <span
                  className={cn(
                    "absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full border",
                    active ? "gradient-primary border-transparent text-primary-foreground" : "border-border bg-card",
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                </span>
                <div className="flex items-start gap-2">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-xl">
                    {p.id === "friendly_coach" ? "👩‍🏫" : p.id === "strict_mentor" ? "👩‍💼" : p.id === "mom_mode" ? "👩" : "🧢"}
                  </div>
                  <div className="min-w-0">
                    <div className={cn("text-[13px] font-extrabold", p.color)}>{p.label}</div>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{p.tagline}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9.5px] font-bold",
                        p.id === "friendly_coach" && "bg-primary/10 text-primary",
                        p.id === "strict_mentor" && "bg-destructive/10 text-destructive",
                        p.id === "mom_mode" && "bg-pink/15 text-pink",
                        p.id === "power_coach" && "bg-warning/15 text-warning",
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Don't miss it out */}
      <div className="mx-4 mt-3 rounded-[22px] border border-destructive/20 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-destructive/10">
            <Bell className="h-5 w-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-extrabold">Don't miss it out</div>
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-destructive-foreground">
                NEW
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              If you set this reminder as very important, Sana will make sure you don't miss it.
            </p>
          </div>
          <Toggle checked={dontMiss} onChange={setDontMiss} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Perk icon={<VolumeX className="h-4 w-4 text-destructive" />} title="Works on Silent" body="Sana will play a loud alert sound even if your phone is on silent." />
          <Perk icon={<PhoneCall className="h-4 w-4 text-destructive" />} title="If you Don't answer the call" body="The loud alert sound will play even if your mobile is in silent." />
          <Perk icon={<Target className="h-4 w-4 text-destructive" />} title="Gets You Started" body="No more snooze. No more delay. Just action." />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-warning/10 p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-[11px] leading-snug">
            <div className="font-bold text-warning">Why this feature?</div>
            <div className="text-muted-foreground">
              Distractions, silent mode, and missed calls can break your focus. This feature is designed to pull you back to what truly matters.
            </div>
          </div>
        </div>
      </div>

      {/* Repeat */}
      <Section>
        <Label className="flex items-center gap-1.5">
          <Repeat className="h-4 w-4" /> Repeat
        </Label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {(["once", "daily", "weekly", "custom"] as RepeatMode[]).map((r) => {
            const active = repeat === r;
            return (
              <button
                key={r}
                onClick={() => setRepeat(r)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-2xl border py-2.5 text-[12px] font-bold capitalize transition",
                  active ? "border-primary/40 bg-lavender text-primary" : "border-border bg-card",
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-full border",
                    active ? "gradient-primary border-transparent" : "border-border",
                  )}
                >
                  {active && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                {r}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Alert */}
      <Section>
        <Label className="flex items-center gap-1.5">
          <Bell className="h-4 w-4" /> Reminder Alert
        </Label>
        <div className="mt-2 flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">Notify me before</span>
          <div className="relative">
            <select
              value={alertBefore}
              onChange={(e) => setAlertBefore(Number(e.target.value))}
              className="appearance-none bg-transparent pr-6 text-right font-bold outline-none"
            >
              {ALERT_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </Section>


      {/* Quote */}
      <Section>
        <Label className="flex items-center gap-1.5">
          <Quote className="h-4 w-4" /> Motivational Quote <span className="font-normal text-muted-foreground">(Optional)</span>
        </Label>
        <div className="mt-2 rounded-2xl border border-border bg-card p-3">
          <div className="text-[11px] font-bold text-muted-foreground">Customize your Quote</div>
          <textarea
            value={quote}
            onChange={(e) => setQuote(e.target.value.slice(0, 80))}
            placeholder="This will be reminded in the call to motivate you."
            className="mt-1 h-16 w-full resize-none bg-transparent text-[12px] font-semibold text-primary outline-none placeholder:text-primary/60"
          />
          <div className="text-right text-[10px] font-semibold text-muted-foreground">{quote.length}/80</div>
        </div>
      </Section>

      {/* Strict mode */}
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-lavender">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold">Enable Strict Mode</div>
          <p className="text-[11px] text-muted-foreground">During this session, all apps will be blocked.</p>
        </div>
        <Toggle checked={strict} onChange={setStrict} />
      </div>

      {/* Submit */}
      <div className="mx-4 mt-5">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !title.trim()}
          className="gradient-primary shadow-soft flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold text-primary-foreground disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          {mutation.isPending ? "Setting…" : "Set Reminder"}
        </button>
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
          <Shield className="h-3 w-3" /> All your reminders are private and secure.
        </p>
      </div>

    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-4 mt-3 rounded-[22px] border border-border bg-card p-4 shadow-card">
      {children}
    </section>
  );
}
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[13px] font-extrabold", className)}>{children}</div>;
}
function Field({
  icon,
  caption,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  caption: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-lavender">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold text-muted-foreground">{caption}</div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-[13px] font-bold outline-none"
        />
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "gradient-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}
function Perk({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-card p-2.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <div className="text-[10.5px] font-extrabold leading-tight">{title}</div>
      </div>
      <p className="mt-1 text-[9.5px] leading-snug text-muted-foreground">{body}</p>
    </div>
  );
}
