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

export function useWebCallReminder() {
  const [activeCallConfig, setActiveCallConfig] = useState<WebCallConfig | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const list = useServerFn(listReminders);
  const { data: reminders } = useQuery<Reminder[]>({
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

  // Listen for client-side test call reschedules
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const handleRescheduleTest = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { minutes, config: testConfig } = detail;
      const delay = minutes * 60_000;

      const timer = setTimeout(() => {
        triggerIncomingWebCall({
          ...testConfig,
          reminderTitle: testConfig?.reminderTitle || "Rescheduled Test Session",
        });
      }, delay);
      timers.push(timer);
    };

    window.addEventListener("reschedule-test-call", handleRescheduleTest);
    return () => {
      window.removeEventListener("reschedule-test-call", handleRescheduleTest);
      timers.forEach(clearTimeout);
    };
  }, []);

  // Monitor scheduled reminders and open incoming call modal when due
  useEffect(() => {
    if (!reminders || typeof window === "undefined") return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const firedSet = new Set<string>();

    for (const r of reminders) {
      if (r.status !== "scheduled") continue;
      const fireAt = new Date(r.scheduled_at).getTime();
      const delay = fireAt - Date.now();

      // Trigger if due now or due within next 24 hours
      if (delay <= 0 && delay > -60_000 && !firedSet.has(r.id)) {
        firedSet.add(r.id);
        setActiveCallConfig({
          reminderId: r.id,
          reminderTitle: r.title,
          persona: r.persona,
          durationMinutes: r.duration_minutes,
        });
        setIsOverlayOpen(true);
      } else if (delay > 0 && delay < 2_147_483_000) {
        timers.push(
          setTimeout(() => {
            firedSet.add(r.id);
            setActiveCallConfig({
              reminderId: r.id,
              reminderTitle: r.title,
              persona: r.persona,
              durationMinutes: r.duration_minutes,
            });
            setIsOverlayOpen(true);
          }, delay)
        );
      }
    }

    return () => timers.forEach(clearTimeout);
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
