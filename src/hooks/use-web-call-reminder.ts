import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReminders } from "@/lib/reminders.functions";
import type { WebCallConfig } from "@/lib/vapi-client";

type Reminder = {
  id: string;
  title: string;
  scheduled_at: string;
  alert_before_minutes: number;
  status: string;
  persona?: string;
  duration_minutes?: number;
};

// Global state emitter so overlay opens across routes
type Listener = (config: WebCallConfig) => void;
const listeners = new Set<Listener>();

export function triggerIncomingWebCall(config: WebCallConfig) {
  listeners.forEach((fn) => fn(config));
}

// Module-level persistent timer registry (survives React hook re-renders & route changes)
const persistentCallTimers = new Map<string, ReturnType<typeof setTimeout>>();
const triggeredReminderIds = new Set<string>();

function registerPersistentCall(key: string, delayMs: number, config: WebCallConfig) {
  if (persistentCallTimers.has(key)) {
    clearTimeout(persistentCallTimers.get(key));
  }
  const timer = setTimeout(() => {
    persistentCallTimers.delete(key);
    triggeredReminderIds.add(key);
    triggerIncomingWebCall(config);
  }, Math.max(500, delayMs));
  persistentCallTimers.set(key, timer);
}

export function useWebCallReminder() {
  const [activeCallConfig, setActiveCallConfig] = useState<WebCallConfig | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const list = useServerFn(listReminders);
  const { data: reminders, refetch } = useQuery<Reminder[]>({
    queryKey: ["reminders"],
    queryFn: () => list() as unknown as Promise<Reminder[]>,
  });

  // Subscribe to manual call triggers
  useEffect(() => {
    const handler: Listener = (config) => {
      setActiveCallConfig(config);
      setIsOverlayOpen(true);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  // Listen for client-side test call reschedules and database updates
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleRescheduleEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { minutes, config: testConfig, id } = detail;
      const delay = (Number(minutes) || 5) * 60_000;
      const key = id || testConfig?.reminderId || `reschedule-${Date.now()}`;

      registerPersistentCall(key, delay, {
        ...testConfig,
        reminderId: id || testConfig?.reminderId,
        reminderTitle: testConfig?.reminderTitle || "Rescheduled Study Session",
      });

      // Refetch reminders query so UI immediately has latest state
      refetch();
    };

    window.addEventListener("reschedule-test-call", handleRescheduleEvent);
    window.addEventListener("reminder-rescheduled", handleRescheduleEvent);
    return () => {
      window.removeEventListener("reschedule-test-call", handleRescheduleEvent);
      window.removeEventListener("reminder-rescheduled", handleRescheduleEvent);
    };
  }, [refetch]);

  // Monitor scheduled reminders from Supabase and register persistent triggers
  useEffect(() => {
    if (!reminders || typeof window === "undefined") return;

    for (const r of reminders) {
      if (r.status !== "scheduled") continue;
      const fireAt = new Date(r.scheduled_at).getTime();
      const delay = fireAt - Date.now();

      // Trigger if due now or due within past 60s
      if (delay <= 0 && delay > -60_000 && !triggeredReminderIds.has(r.id)) {
        triggeredReminderIds.add(r.id);
        setActiveCallConfig({
          reminderId: r.id,
          reminderTitle: r.title,
          persona: r.persona,
          durationMinutes: r.duration_minutes,
        });
        setIsOverlayOpen(true);
      } else if (delay > 0 && delay < 2_147_483_000 && !triggeredReminderIds.has(r.id)) {
        registerPersistentCall(r.id, delay, {
          reminderId: r.id,
          reminderTitle: r.title,
          persona: r.persona,
          durationMinutes: r.duration_minutes,
        });
      }
    }
  }, [reminders]);

  const closeWebCall = useCallback(() => {
    setIsOverlayOpen(false);
    setActiveCallConfig(null);
  }, []);

  const triggerTestCall = useCallback((customTitle?: string) => {
    triggerIncomingWebCall({
      reminderTitle: customTitle || "Functions & Modules Revision",
      topic: "Python & Data Structures",
      userName: "",
      persona: "friendly_coach",
    });
  }, []);

  return {
    isOverlayOpen,
    activeCallConfig,
    closeWebCall,
    triggerTestCall,
  };
}
