// Twilio webhook: called after each <Gather input="speech"> recognition.
// Receives SpeechResult, feeds Groq LLM, returns next TwiML.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateTurn, voiceSystemPrompt, parseControlMarkers, type VoicePersona } from "@/lib/voice-ai.server";
import { fetchCallContext, contextToSystemAddendum } from "@/lib/voice-context.server";
import { gather, say, twimlResponse, nextOccurrence } from "@/lib/voice-dispatch.server";

type TranscriptTurn = { role: "user" | "assistant"; content: string };

async function handle(request: Request, url: URL) {
  const reminderId = url.searchParams.get("reminder_id");
  if (!reminderId) return twimlResponse(say("Session lost. Goodbye.") + "<Hangup/>");

  const form = await request.formData().catch(() => null);
  const callSid = (form?.get("CallSid") as string | null) ?? "";
  const heard = ((form?.get("SpeechResult") as string | null) ?? "").trim();

  const { data: session } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  const { data: reminder } = await supabaseAdmin
    .from("study_call_reminders")
    .select("*")
    .eq("id", reminderId)
    .single();
  if (!reminder) return twimlResponse(say("Session lost. Goodbye.") + "<Hangup/>");

  const origin = new URL(request.url).origin;
  const turnUrl = `${origin}/api/public/voice/turn?reminder_id=${reminder.id}`;

  const prevTranscript: TranscriptTurn[] =
    (session?.transcript as TranscriptTurn[] | null | undefined) ?? [];

  // If we heard nothing, gently re-prompt without burning an LLM call.
  if (!heard) {
    return twimlResponse(say("Are you still there? I didn't quite catch that.") + gather(turnUrl));
  }

  const newTranscript: TranscriptTurn[] = [...prevTranscript, { role: "user", content: heard }];

  const ctx = await fetchCallContext(reminder.user_id, reminder.id);
  const system =
    voiceSystemPrompt(reminder.motivation_style as VoicePersona, ctx.displayName) +
    contextToSystemAddendum(ctx);

  let raw = "";
  try {
    raw = await generateTurn(system, newTranscript);
  } catch (err) {
    console.error("[voice/turn] LLM error", err);
    return twimlResponse(
      say("Hmm, my brain lagged for a second. Give me a moment and try again.") + gather(turnUrl),
    );
  }

  const { spoken, followUpMinutes, endCall } = parseControlMarkers(raw);
  const replyText = spoken || "Got it. Tell me more.";

  const nextTranscript: TranscriptTurn[] = [...newTranscript, { role: "assistant", content: replyText }];
  await supabaseAdmin
    .from("call_sessions")
    .update({ transcript: nextTranscript })
    .eq("twilio_call_sid", callSid);

  // If AI promised a follow-up call, schedule it.
  if (followUpMinutes && followUpMinutes > 0 && followUpMinutes <= 24 * 60) {
    const next = new Date(Date.now() + followUpMinutes * 60_000).toISOString();
    await supabaseAdmin.from("study_call_reminders").insert({
      user_id: reminder.user_id,
      title: `Follow-up: ${reminder.title}`,
      phone_e164: reminder.phone_e164,
      study_topic: reminder.study_topic,
      motivation_style: reminder.motivation_style,
      scheduled_at: next,
      next_call_at: next,
      repeat_type: "once",
    });
    await supabaseAdmin
      .from("call_sessions")
      .update({ follow_up_at: next })
      .eq("twilio_call_sid", callSid);
  }

  if (endCall) {
    // Roll the reminder forward if it repeats.
    const roll = nextOccurrence(reminder.scheduled_at, reminder.repeat_type);
    if (roll) {
      await supabaseAdmin
        .from("study_call_reminders")
        .update({ status: "scheduled", scheduled_at: roll, next_call_at: roll })
        .eq("id", reminder.id);
    } else {
      await supabaseAdmin.from("study_call_reminders").update({ status: "done" }).eq("id", reminder.id);
    }
    return twimlResponse(say(replyText) + "<Hangup/>");
  }

  return twimlResponse(say(replyText) + gather(turnUrl));
}

export const Route = createFileRoute("/api/public/voice/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request, new URL(request.url)),
    },
  },
});
