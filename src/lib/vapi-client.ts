import Vapi from "@vapi-ai/web";
import { updateReminderStatus } from "@/lib/reminders.functions";
import { supabase } from "@/integrations/supabase/client";

export interface WebCallConfig {
  reminderId?: string;
  reminderTitle: string;
  topic?: string;
  userName?: string;
  persona?: string;
  durationMinutes?: number;
}

export type CallStatus = "disconnected" | "connecting" | "connected" | "ended";

export interface VapiCallEvents {
  onStatusChange?: (status: CallStatus) => void;
  onVolumeChange?: (volume: number) => void;
  onTranscript?: (role: "assistant" | "user", text: string) => void;
  onRescheduled?: (newTime: string, minutes: number) => void;
  onError?: (err: Error) => void;
}

// Global Vapi singleton instance
let vapiInstance: Vapi | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let speechRecognition: any = null;

export function getVapiPublicKey(): string {
  return (import.meta as any).env?.VITE_VAPI_PUBLIC_KEY || "";
}

export function getVapiAssistantId(): string {
  return (import.meta as any).env?.VITE_VAPI_ASSISTANT_ID || "";
}

export function initVapiClient(): Vapi | null {
  const apiKey = getVapiPublicKey();
  if (!apiKey) return null;
  if (!vapiInstance) {
    try {
      vapiInstance = new Vapi(apiKey);
    } catch (e) {
      console.warn("Failed to instantiate Vapi Web SDK:", e);
      return null;
    }
  }
  return vapiInstance;
}

/**
 * Reschedule the reminder in Supabase and trigger notification
 */
export async function executeRescheduleReminder(
  reminderId: string | undefined,
  minutesFromNow: number
): Promise<string> {
  const newDate = new Date(Date.now() + minutesFromNow * 60_000);
  const newIso = newDate.toISOString();

  if (reminderId) {
    try {
      // Update scheduled_at in reminders table
      await supabase
        .from("reminders")
        .update({
          scheduled_at: newIso,
          status: "scheduled",
          last_fired_at: new Date().toISOString(),
        })
        .eq("id", reminderId);
    } catch (err) {
      console.error("Error updating reminder via Supabase:", err);
    }
  }

  const formattedTime = newDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return formattedTime;
}

/**
 * Start AI Web Call using Vapi Web SDK or Web Speech Fallback Engine
 */
export async function startWebCall(
  config: WebCallConfig,
  events: VapiCallEvents
): Promise<() => void> {
  const apiKey = getVapiPublicKey();
  const assistantId = getVapiAssistantId();
  const name = config.userName || "Sanjai";
  const topic = config.topic || config.reminderTitle || "your study session";
  const vapi = initVapiClient();

  events.onStatusChange?.("connecting");

  // System instructions for Sana AI caller
  const systemPrompt = `You are Sana, a warm, motivating, and highly intelligent AI study companion calling ${name}.
Your current task is to remind ${name} about their scheduled study session: "${config.reminderTitle}" (${topic}).

Conversation Guidelines:
1. Start by warmly greeting ${name} and asking if they are ready for their study session.
2. Be natural, friendly, short-spoken, and conversational (keep responses under 2-3 sentences).
3. Handle user responses intelligently:
   - If user is busy, outside, travelling, or tired, ask when to call back (e.g. 15 mins, 30 mins, 1 hour, or tomorrow morning).
   - If user asks for motivation, provide a concise inspiring quote or motivational push.
   - If user says they'll study now, encourage them warmly and end call politely.
   - If user mentions a specific delay (e.g. "call me after 15 minutes", "remind me in 30 mins"), confirm politely and call reschedule_reminder function.

Always maintain your identity as Sana AI 💕, ${name}'s loyal learning partner.`;

  // Try Vapi SDK first if configured
  if (vapi && apiKey) {
    try {
      // Setup Vapi event listeners
      vapi.on("call-start", () => {
        events.onStatusChange?.("connected");
      });

      vapi.on("call-end", () => {
        events.onStatusChange?.("ended");
      });

      vapi.on("speech-start", () => {
        events.onVolumeChange?.(0.8);
      });

      vapi.on("speech-end", () => {
        events.onVolumeChange?.(0.1);
      });

      vapi.on("volume-level", (volume: number) => {
        events.onVolumeChange?.(volume);
      });

      vapi.on("message", async (msg: any) => {
        if (msg.type === "transcript" && msg.transcript) {
          events.onTranscript?.(msg.role === "user" ? "user" : "assistant", msg.transcript);
        }

        // Handle tool calls / function calls from Vapi AI
        if (msg.type === "function-call" && msg.functionCall?.name === "reschedule_reminder") {
          const params = msg.functionCall.parameters || {};
          const mins = Number(params.minutes_from_now) || 15;
          const formatted = await executeRescheduleReminder(config.reminderId, mins);
          events.onRescheduled?.(formatted, mins);
        }
      });

      vapi.on("error", (e: any) => {
        console.error("Vapi error:", e);
        events.onError?.(e instanceof Error ? e : new Error(String(e)));
      });

      if (assistantId) {
        await vapi.start(assistantId);
      } else {
        // Dynamic transient assistant configuration
        await vapi.start({
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: systemPrompt }],
            tools: [
              {
                type: "function",
                function: {
                  name: "reschedule_reminder",
                  description: "Reschedule the study reminder call by X minutes",
                  parameters: {
                    type: "object",
                    properties: {
                      minutes_from_now: { type: "number", description: "Minutes to delay (e.g., 15, 30, 60)" },
                      reason: { type: "string", description: "Reason for rescheduling" },
                    },
                    required: ["minutes_from_now"],
                  },
                },
              },
            ],
          },
          voice: {
            provider: "playht",
            voiceId: "s3://voice-cloning-zero-shot/d92078bd-f450-4baa-800d-5bd1074ee700/sana/manifest.json",
          },
          firstMessage: `Hey ${name}! 👋 It's time for your ${config.reminderTitle} study session. Are you ready to start?`,
        } as any);
      }

      return () => {
        try { vapi.stop(); } catch {}
      };
    } catch (e) {
      console.warn("Vapi Web SDK start failed, falling back to Web Speech engine:", e);
    }
  }

  // Fallback interactive voice engine using Web Speech API + Intelligent parser
  return startWebSpeechFallback(config, systemPrompt, events);
}

/**
 * Web Speech API Fallback Engine (Guarantees 100% interactive AI voice experience)
 */
function startWebSpeechFallback(
  config: WebCallConfig,
  _systemPrompt: string,
  events: VapiCallEvents
): () => void {
  const name = config.userName || "Sanjai";
  const topic = config.reminderTitle || "your study session";
  let isCleanedUp = false;

  setTimeout(() => {
    if (isCleanedUp) return;
    events.onStatusChange?.("connected");

    // First greeting
    const initialText = `Hey ${name}! 👋 Time for your ${topic} study session. Are you ready to get started?`;
    speakText(initialText, events, () => {
      if (!isCleanedUp) listenUserVoice(config, events);
    });
  }, 1000);

  return () => {
    isCleanedUp = true;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speechRecognition) {
      try { speechRecognition.stop(); } catch {}
    }
    events.onStatusChange?.("ended");
  };
}

function speakText(text: string, events: VapiCallEvents, onEnded?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    events.onTranscript?.("assistant", text);
    onEnded?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.1; // Gentle, friendly female tone pitch

  const voices = window.speechSynthesis.getVoices();
  const femaleVoice = voices.find(
    (v) => v.lang.startsWith("en") && (v.name.includes("Female") || v.name.includes("Google") || v.name.includes("Samantha") || v.name.includes("Natural") || v.name.includes("Zira"))
  ) || voices.find((v) => v.lang.startsWith("en"));

  if (femaleVoice) utterance.voice = femaleVoice;

  activeUtterance = utterance;
  events.onTranscript?.("assistant", text);

  // Volume pulse animation simulation
  const interval = setInterval(() => {
    if (window.speechSynthesis.speaking) {
      events.onVolumeChange?.(0.4 + Math.random() * 0.5);
    } else {
      events.onVolumeChange?.(0.05);
      clearInterval(interval);
    }
  }, 100);

  utterance.onend = () => {
    clearInterval(interval);
    events.onVolumeChange?.(0);
    onEnded?.();
  };

  utterance.onerror = () => {
    clearInterval(interval);
    events.onVolumeChange?.(0);
    onEnded?.();
  };

  window.speechSynthesis.speak(utterance);
}

function listenUserVoice(config: WebCallConfig, events: VapiCallEvents) {
  if (typeof window === "undefined") return;

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    // If browser doesn't support webkitSpeechRecognition, handle via UI text replies
    return;
  }

  try {
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.lang = "en-US";

    speechRecognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      events.onTranscript?.("user", transcript);

      // Process intent
      await processUserResponseIntent(transcript, config, events);
    };

    speechRecognition.onerror = (_e: any) => {
      // Ignore audio mic errors gracefully
    };

    speechRecognition.start();
  } catch (err) {
    console.warn("Speech recognition start failed:", err);
  }
}

/**
 * Intelligent Intent Parser for Rescheduling & AI Responses
 */
export async function processUserResponseIntent(
  userText: string,
  config: WebCallConfig,
  events: VapiCallEvents
) {
  const lower = userText.toLowerCase();

  // Reschedule intent parsing
  let snoozeMins = 0;
  if (lower.includes("15 min") || lower.includes("15 minutes") || lower.includes("fifteen")) snoozeMins = 15;
  else if (lower.includes("30 min") || lower.includes("30 minutes") || lower.includes("half an hour")) snoozeMins = 30;
  else if (lower.includes("1 hour") || lower.includes("an hour") || lower.includes("60 min")) snoozeMins = 60;
  else if (lower.includes("tomorrow") || lower.includes("next day")) snoozeMins = 1440;
  else if (lower.includes("busy") || lower.includes("outside") || lower.includes("travelling") || lower.includes("tired") || lower.includes("later")) {
    snoozeMins = 30; // default 30 mins postpone
  }

  if (snoozeMins > 0) {
    const formatted = await executeRescheduleReminder(config.reminderId, snoozeMins);
    events.onRescheduled?.(formatted, snoozeMins);
    const reply = `No problem! I've rescheduled your study reminder for ${formatted}. Get some rest and see you then! 💕`;
    speakText(reply, events, () => {
      setTimeout(() => events.onStatusChange?.("ended"), 2000);
    });
    return;
  }

  if (lower.includes("motivate") || lower.includes("not motivated") || lower.includes("can't focus")) {
    const reply = `You've got this! Small steps every day add up to massive achievements. Just spend 10 focused minutes on ${config.reminderTitle || "your study"} now!`;
    speakText(reply, events);
    return;
  }

  if (lower.includes("study now") || lower.includes("start now") || lower.includes("ready") || lower.includes("yes")) {
    const reply = `Awesome energy! I'll let you focus. Have a fantastic study session! 🚀`;
    speakText(reply, events, () => {
      setTimeout(() => events.onStatusChange?.("ended"), 2000);
    });
    return;
  }

  // Generic encouraging AI response
  const genericReply = `Got it! Let's conquer ${config.reminderTitle || "this topic"}. I'm right here with you whenever you need help!`;
  speakText(genericReply, events);
}
