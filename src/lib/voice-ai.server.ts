// LLM helpers for voice calls: turn generation + post-call summarization.
// Uses Groq for low-latency voice turn generation.

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type VoicePersona = "friendly_coach" | "strict_mentor" | "mom_mode" | "power_coach";

export function voiceSystemPrompt(persona: VoicePersona, name: string | null): string {
  const who = name ?? "friend";
  const style: Record<VoicePersona, string> = {
    friendly_coach:
      "You are Sana, a warm, encouraging AI study companion on a live phone call. Be conversational and human.",
    strict_mentor:
      "You are Sana, a disciplined, no-nonsense study mentor on a live phone call. Direct and structured, but never mean.",
    mom_mode:
      "You are Sana, a caring, motherly AI companion on a live phone call. Gentle, warm, protective.",
    power_coach:
      "You are Sana, a high-energy, exciting study coach on a live phone call. Motivational and upbeat.",
  };
  return `${style[persona]}

You are speaking to ${who} over an actual phone call. CRITICAL rules:
1. Speak like a real human on a call — short sentences (10–20 words), natural pauses, contractions.
2. NEVER use markdown, lists, code blocks, emojis, or asterisks. It is being read aloud by a TTS voice.
3. One idea per turn. Ask one question at a time. Give them room to answer.
4. If the user is busy, sick, or wants to reschedule, acknowledge it warmly and offer a new time.
5. If you promise to call again ("I'll call you in 30 minutes"), end that turn with the exact phrase "SCHEDULE_FOLLOWUP:<minutes>" on its own final line so the system can pick it up. The user will never hear that line — the system strips it.
6. If the user clearly wants to end the call, say goodbye and end with "END_CALL" on its own final line.
7. Never invent facts about their schedule. Use only the context provided.
8. Keep energy warm and personal. Use their name occasionally.`;
}

import { generateText } from "ai";
import { getGroqModel } from "@/lib/ai-groq.server";

/** Generate the AI's next spoken turn given the transcript so far. */
export async function generateTurn(system: string, transcript: ChatMsg[]): Promise<string> {
  const model = getGroqModel();
  try {
    const { text } = await generateText({
      model,
      system,
      messages: transcript,
      temperature: 0.7,
    });
    return text.trim() || "Sorry, I lost you there. Could you say that again?";
  } catch (err) {
    console.error("AI gateway error:", err);
    throw err;
  }
}

/** Parse control markers from the model's raw output and return spoken text + directives. */
export function parseControlMarkers(raw: string): {
  spoken: string;
  followUpMinutes: number | null;
  endCall: boolean;
} {
  let followUpMinutes: number | null = null;
  let endCall = false;

  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const m = /^\s*SCHEDULE_FOLLOWUP:\s*(\d+)\s*$/i.exec(line);
    if (m) {
      followUpMinutes = parseInt(m[1], 10);
      continue;
    }
    if (/^\s*END_CALL\s*$/i.test(line)) {
      endCall = true;
      continue;
    }
    kept.push(line);
  }
  return { spoken: kept.join(" ").replace(/\s+/g, " ").trim(), followUpMinutes, endCall };
}

import { generateObject } from "ai";
import { z } from "zod";

/** Summarize a completed call. */
export async function summarizeCall(transcript: ChatMsg[]): Promise<{
  summary: string;
  mood: string;
  topics: string[];
  action_taken: string;
}> {
  const model = getGroqModel();
  const flat = transcript
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "assistant" ? "Sana" : "User"}: ${m.content}`)
    .join("\n");

  try {
    const { object } = await generateObject({
      model,
      system:
        "Summarize this phone-call transcript between Sana (an AI study coach) and a student. Return strict JSON with keys: summary (2-3 sentences), mood (one word like focused, tired, motivated, anxious), topics (array of study topics discussed), action_taken (one short sentence describing what was agreed).",
      prompt: flat || "(empty call)",
      schema: z.object({
        summary: z.string(),
        mood: z.string(),
        topics: z.array(z.string()),
        action_taken: z.string(),
      }),
    });
    return object;
  } catch (err) {
    console.error("summarizeCall error:", err);
    return { summary: "Call ended.", mood: "unknown", topics: [], action_taken: "No action recorded." };
  }
}
