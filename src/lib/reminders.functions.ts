import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["study", "break", "revision", "custom"]),
  scheduled_at: z.string(),
  duration_minutes: z.number().int().positive(),
  persona: z.string(),
  repeat_mode: z.enum(["once", "daily", "weekly", "custom"]),
  alert_before_minutes: z.number().int().nonnegative(),
  quote: z.string().nullable().optional(),
  strict_mode: z.boolean(),
  dont_miss: z.boolean(),
  ai_call: z.boolean(),
});

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("reminders")
      .insert({ ...data, user_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .order("scheduled_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reminders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateReminderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["scheduled", "done", "missed", "snoozed", "paused"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reminders")
      .update({ status: data.status, last_fired_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const RescheduleReminderSchema = z.object({
  id: z.string().optional().nullable(),
  minutes_from_now: z.number().int().positive(),
  title: z.string().optional(),
  topic: z.string().optional(),
  persona: z.string().optional(),
});

export const rescheduleReminder = createServerFn({ method: "POST" })
  .validator((d: unknown) => RescheduleReminderSchema.parse(d))
  .handler(async ({ data }) => {
    const newDate = new Date(Date.now() + data.minutes_from_now * 60_000);
    const newIso = newDate.toISOString();
    const formattedTime = newDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Determine user ID dynamically
    let userId: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const request = getRequest();
      const authHeader = request?.headers?.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: claimsData } = await supabaseAdmin.auth.getClaims(token);
        if (claimsData?.claims?.sub) {
          userId = claimsData.claims.sub;
        }
      }
    } catch {}

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!userId) {
      const { data: latestProfile } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      userId = latestProfile?.user_id || null;
    }

    if (!userId) {
      const { data: latestReminder } = await supabaseAdmin
        .from("reminders")
        .select("user_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      userId = latestReminder?.user_id || null;
    }

    if (data.id) {
      // Update existing reminder
      const { data: updated, error } = await supabaseAdmin
        .from("reminders")
        .update({
          scheduled_at: newIso,
          status: "scheduled",
          last_fired_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .select()
        .maybeSingle();

      if (!error && updated) {
        return {
          id: updated.id,
          title: updated.title,
          scheduled_at: newIso,
          formatted_time: formattedTime,
        };
      }
    }

    // If no existing ID or ID was not found, insert a new scheduled reminder into Supabase
    if (userId) {
      const title = data.title || "Study session with Sana";
      const { data: created, error: createError } = await supabaseAdmin
        .from("reminders")
        .insert({
          user_id: userId,
          title,
          type: "study",
          scheduled_at: newIso,
          duration_minutes: 25,
          persona: data.persona || "friendly_coach",
          repeat_mode: "once",
          alert_before_minutes: 0,
          strict_mode: false,
          dont_miss: true,
          ai_call: true,
          status: "scheduled",
        })
        .select()
        .single();

      if (!createError && created) {
        return {
          id: created.id,
          title: created.title,
          scheduled_at: newIso,
          formatted_time: formattedTime,
        };
      }
    }

    return {
      id: data.id || "local-" + Date.now(),
      title: data.title || "Study session with Sana",
      scheduled_at: newIso,
      formatted_time: formattedTime,
    };
  });
