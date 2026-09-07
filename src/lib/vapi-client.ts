import Vapi from "@vapi-ai/web";
import { updateReminderStatus, rescheduleReminder } from "@/lib/reminders.functions";
import { supabase } from "@/integrations/supabase/client";
import { generateWebCallTurn, synthesizeSpeechServerFn } from "@/lib/voice-call.functions";

export interface WebCallConfig {
  reminderId?: string;
  reminderTitle: string;
  topic?: string;
  userName?: string;
  persona?: string;
  durationMinutes?: number;
  language?: string;
}

export type CallStatus = "disconnected" | "connecting" | "connected" | "ended";
export type VoiceConversationState = "idle" | "speaking" | "listening" | "thinking";

export interface VapiCallEvents {
  onStatusChange?: (status: CallStatus) => void;
  onVolumeChange?: (volume: number) => void;
  onTranscript?: (role: "assistant" | "user", text: string) => void;
  onRescheduled?: (newTime: string, minutes: number) => void;
  onError?: (err: Error) => void;
  onVoiceStateChange?: (state: VoiceConversationState) => void;
}

// Global instances
let vapiInstance: Vapi | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
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
  minutesFromNow: number,
  config?: WebCallConfig
): Promise<string> {
  const newDate = new Date(Date.now() + minutesFromNow * 60_000);
  let formattedTime = newDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  let savedId = reminderId;

  try {
    const result = await rescheduleReminder({
      data: {
        id: reminderId || null,
        minutes_from_now: minutesFromNow,
        title: config?.reminderTitle,
        topic: config?.topic,
        persona: config?.persona,
      },
    });

    if (result) {
      formattedTime = result.formatted_time;
      savedId = result.id;
    }
  } catch (err) {
    console.warn("Could not reschedule via server fn, falling back locally:", err);
    if (reminderId) {
      try {
        await supabase
          .from("reminders")
          .update({
            scheduled_at: newDate.toISOString(),
            status: "scheduled",
            last_fired_at: new Date().toISOString(),
          })
          .eq("id", reminderId);
      } catch {}
    }
  }

  // Broadcast events so UI (Upcoming AI Calls) and persistent timer immediately react
  if (typeof window !== "undefined") {
    const detail = {
      id: savedId,
      minutes: minutesFromNow,
      scheduled_at: newDate.toISOString(),
      config: {
        ...config,
        reminderId: savedId,
      },
    };
    window.dispatchEvent(new CustomEvent("reminder-rescheduled", { detail }));
    window.dispatchEvent(new CustomEvent("reschedule-test-call", { detail }));
  }

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
  const topic = config.topic || config.reminderTitle || "your study session";
  const vapi = initVapiClient();

  events.onStatusChange?.("connecting");

  // System instructions for Sana AI caller
  const systemPrompt = `You are Sana, a warm, motivating, and highly intelligent AI study companion.
Your current task is to remind the student about their scheduled study session: "${config.reminderTitle}" (${topic}).

Conversation Guidelines:
1. Start by warmly greeting the student with a neutral greeting (such as "Hey!", "Hello!", or "Hi there!") and asking if they are ready for their study session.
2. Be natural, friendly, short-spoken, and conversational (keep responses under 2-3 sentences).
3. Handle user responses intelligently:
   - If user is busy, outside, travelling, or tired, ask when to call back (e.g. 15 mins, 30 mins, 1 hour, or tomorrow morning).
   - If user asks for motivation, provide a concise inspiring quote or motivational push.
   - If user says they'll study now, encourage them warmly and end call politely.
   - If user mentions a specific delay (e.g. "call me after 15 minutes", "remind me in 30 mins"), confirm politely and call reschedule_reminder function.

Always maintain your identity as Sana AI 💕, their loyal learning partner.`;

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
          const formatted = await executeRescheduleReminder(config.reminderId, mins, config);
          events.onRescheduled?.(formatted, mins);
        }
      });

      vapi.on("error", (e: any) => {
        console.error("Vapi error:", e);
        events.onError?.(e instanceof Error ? e : new Error(String(e)));
      });

      if (assistantId) {
        await vapi.start(assistantId, {
          voice: {
            provider: "playht",
            voiceId: "s3://voice-cloning-zero-shot/d92078bd-f450-4baa-800d-5bd1074ee700/sana/manifest.json",
          },
          firstMessage: `Hey there! 👋 It's time for your ${config.reminderTitle} study session. Are you ready to start?`,
        } as any);
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
          firstMessage: `Hey there! 👋 It's time for your ${config.reminderTitle} study session. Are you ready to start?`,
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
 * Stops any currently active speech synthesis or audio playback
 */
export function stopActiveAudio() {
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
      activeAudioElement.src = "";
    } catch {}
    activeAudioElement = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
}

/**
 * Control speaker mute state across HTML5 Audio and Web Speech
 */
export function setAudioSpeakerMuted(muted: boolean) {
  if (activeAudioElement) {
    activeAudioElement.muted = muted;
  }
  if (muted && typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Playbase64 MP3 generated by ElevenLabs with visual volume pulses
 */
export function playAudioBase64(
  base64: string,
  events: VapiCallEvents,
  onEnded?: () => void,
  onErrorFallback?: () => void
) {
  stopActiveAudio();

  try {
    const audio = new Audio("data:audio/mpeg;base64," + base64);
    activeAudioElement = audio;

    let volumeInterval: any = null;

    audio.onplay = () => {
      volumeInterval = setInterval(() => {
        if (activeAudioElement && !activeAudioElement.paused) {
          events.onVolumeChange?.(0.35 + Math.random() * 0.45);
        }
      }, 100);
    };

    const cleanupAudio = () => {
      if (volumeInterval) {
        clearInterval(volumeInterval);
        volumeInterval = null;
      }
      events.onVolumeChange?.(0);
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
    };

    audio.onended = () => {
      cleanupAudio();
      onEnded?.();
    };

    audio.onerror = (e) => {
      console.warn("ElevenLabs audio playback error, falling back to Web Speech:", e);
      cleanupAudio();
      onErrorFallback?.();
    };

    audio.play().catch((err) => {
      console.warn("Failed to autoplay ElevenLabs audio, falling back to Web Speech:", err);
      cleanupAudio();
      onErrorFallback?.();
    });
  } catch (err) {
    console.warn("Audio element creation error, falling back to Web Speech:", err);
    onErrorFallback?.();
  }
}

/**
 * Web Speech API Fallback Engine (Guarantees 100% interactive AI voice experience)
 */
function startWebSpeechFallback(
  config: WebCallConfig,
  _systemPrompt: string,
  events: VapiCallEvents
): () => void {
  const topic = config.topic || config.reminderTitle || "your study session";
  let isCleanedUp = false;
  let isSpeaking = false;
  const conversationHistory: Array<{ role: "assistant" | "user"; content: string }> = [];

  const cleanup = () => {
    isCleanedUp = true;
    stopActiveAudio();
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch {}
      speechRecognition = null;
    }
    events.onVoiceStateChange?.("idle");
  };

  const speakTurn = (text: string, audioBase64?: string | null, onDone?: () => void) => {
    if (isCleanedUp) return;
    isSpeaking = true;
    events.onVoiceStateChange?.("speaking");
    events.onTranscript?.("assistant", text);

    const finish = () => {
      isSpeaking = false;
      if (isCleanedUp) return;
      events.onVoiceStateChange?.("idle");
      if (onDone) {
        onDone();
      } else {
        startListeningLoop();
      }
    };

    if (audioBase64) {
      playAudioBase64(
        audioBase64,
        events,
        finish,
        () => {
          // Fallback to Web Speech Synthesis if audio playback fails
          speakTextActual(text, events, finish, config.language);
        }
      );
    } else {
      speakText(text, events, finish, config.language);
    }
  };

  const startListeningLoop = () => {
    if (isCleanedUp || isSpeaking) return;
    events.onVoiceStateChange?.("listening");

    listenUserVoiceLoop(config, events, async (transcript) => {
      if (isCleanedUp) return;
      conversationHistory.push({ role: "user", content: transcript });
      events.onVoiceStateChange?.("thinking");

      try {
        const turnResult = await generateWebCallTurn({
          data: {
            reminderTitle: config.reminderTitle,
            topic: config.topic,
            userName: config.userName,
            persona: config.persona,
            language: config.language || "en",
            messages: conversationHistory,
          },
        });

        if (isCleanedUp) return;

        let rescheduleMins = turnResult.rescheduleMinutes;
        // Dual-check with regex parser for natural phrases like "call me after 5 minutes"
        if (!rescheduleMins) {
          const parsed = parseSnoozeMinutes(transcript);
          if (parsed > 0) {
            rescheduleMins = parsed;
          }
        }

        conversationHistory.push({ role: "assistant", content: turnResult.spokenText });

        if (rescheduleMins && rescheduleMins > 0) {
          const formatted = await executeRescheduleReminder(config.reminderId, rescheduleMins, config);
          events.onRescheduled?.(formatted, rescheduleMins);
          speakTurn(turnResult.spokenText, turnResult.audioBase64, () => {
            setTimeout(() => {
              if (!isCleanedUp) {
                events.onStatusChange?.("ended");
              }
            }, 1200);
          });
          return;
        }

        if (turnResult.endCall) {
          speakTurn(turnResult.spokenText, turnResult.audioBase64, () => {
            setTimeout(() => {
              if (!isCleanedUp) {
                events.onStatusChange?.("ended");
              }
            }, 1200);
          });
          return;
        }

        // Continuous turn-taking: Speak Sana's contextual answer, then listen again!
        speakTurn(turnResult.spokenText, turnResult.audioBase64, () => {
          startListeningLoop();
        });
      } catch (err) {
        console.warn("AI generation error, using smart fallback intent handler:", err);
        // Fallback to local rule processor to ensure 100% reliability
        await processUserResponseIntent(transcript, config, events);
      }
    });
  };

  // Kick off first turn: warm greeting
  setTimeout(async () => {
    if (isCleanedUp) return;
    events.onStatusChange?.("connected");

    let initialText = `Hey there! Time for your ${topic} study session. Are you ready?`;
    if (config.language === "ta") {
      initialText = `வணக்கம்! உங்கள் ${topic} படிப்பு நேரம் வந்துவிட்டது. நீங்கள் தயாரா?`;
    } else if (config.language === "hi") {
      initialText = `नमस्ते! आपकी ${topic} पढ़ाई का समय हो गया है। क्या आप तैयार हैं?`;
    } else if (config.language === "es") {
      initialText = `¡Hola! Es hora de tu sesión de estudio de ${topic}. ¿Estás listo?`;
    }

    conversationHistory.push({ role: "assistant", content: initialText });

    try {
      const synthRes = await synthesizeSpeechServerFn({ data: { text: initialText } });
      if (isCleanedUp) return;
      speakTurn(initialText, synthRes.audioBase64, () => {
        startListeningLoop();
      });
    } catch {
      if (isCleanedUp) return;
      speakTurn(initialText, null, () => {
        startListeningLoop();
      });
    }
  }, 600);

  return () => {
    cleanup();
    events.onStatusChange?.("ended");
  };
}

export function speakText(
  text: string,
  events: VapiCallEvents,
  onEnded?: () => void,
  lang?: string
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    events.onTranscript?.("assistant", text);
    onEnded?.();
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    // Chrome loads voices asynchronously. Wait for them.
    const handleVoicesChanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      speakTextActual(text, events, onEnded, lang);
    };
    window.speechSynthesis.onvoiceschanged = handleVoicesChanged;

    setTimeout(() => {
      if (window.speechSynthesis.onvoiceschanged === handleVoicesChanged) {
        window.speechSynthesis.onvoiceschanged = null;
        speakTextActual(text, events, onEnded, lang);
      }
    }, 250);
    return;
  }

  speakTextActual(text, events, onEnded, lang);
}

function speakTextActual(
  text: string,
  events: VapiCallEvents,
  onEnded?: () => void,
  lang?: string
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    events.onTranscript?.("assistant", text);
    onEnded?.();
    return;
  }

  stopActiveAudio();

  // Strip markdown, asterisks and emojis so TTS pronounces pure natural speech
  const cleanSpeechText = text
    .replace(/[*_~`#]/g, "")
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .trim();

  const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
  utterance.rate = 1.0;
  utterance.pitch = 1.1; // Gentle, friendly female tone pitch

  const voices = window.speechSynthesis.getVoices();

  // Multilingual voice selection
  let matchedVoice: SpeechSynthesisVoice | undefined;
  if (lang && !lang.startsWith("en")) {
    const langPrefix = lang.toLowerCase().split("-")[0];
    matchedVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }

  // Detect script (Tamil / Hindi) if not found yet
  if (!matchedVoice) {
    if (/[\u0B80-\u0BFF]/.test(cleanSpeechText)) {
      matchedVoice = voices.find((v) => v.lang.toLowerCase().startsWith("ta"));
    } else if (/[\u0900-\u097F]/.test(cleanSpeechText)) {
      matchedVoice = voices.find((v) => v.lang.toLowerCase().startsWith("hi"));
    }
  }

  if (!matchedVoice) {
    const prioritizedFemaleVoiceNames = [
      "Google US English",
      "Microsoft Zira Desktop - English (United States)",
      "Microsoft Zira Desktop",
      "Samantha",
      "Victoria",
      "Hazel",
      "Zira",
    ];

    matchedVoice = voices.find((v) => {
      if (!v.lang.startsWith("en")) return false;
      const nameLower = v.name.toLowerCase();
      return prioritizedFemaleVoiceNames.some((prefName) => nameLower.includes(prefName.toLowerCase()));
    });

    if (!matchedVoice) {
      matchedVoice = voices.find((v) => {
        if (!v.lang.startsWith("en")) return false;
        const nameLower = v.name.toLowerCase();
        return (
          nameLower.includes("female") ||
          nameLower.includes("samantha") ||
          nameLower.includes("zira") ||
          nameLower.includes("hazel") ||
          nameLower.includes("karen") ||
          nameLower.includes("susan") ||
          nameLower.includes("tessa") ||
          nameLower.includes("moira")
        );
      });
    }

    if (!matchedVoice) {
      matchedVoice = voices.find((v) => v.lang.startsWith("en"));
    }
  }

  if (matchedVoice) {
    utterance.voice = matchedVoice;
    utterance.lang = matchedVoice.lang;
  }

  activeUtterance = utterance;
  events.onTranscript?.("assistant", text);

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

function getSpeechRecognitionLang(langPreference?: string): string {
  if (!langPreference || langPreference === "auto") {
    return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
  }
  const map: Record<string, string> = {
    en: "en-US",
    ta: "ta-IN",
    hi: "hi-IN",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    te: "te-IN",
    kn: "kn-IN",
    ml: "ml-IN",
  };
  return map[langPreference] || langPreference;
}

function listenUserVoiceLoop(
  _config: WebCallConfig,
  events: VapiCallEvents,
  onSpeechResult: (text: string) => void
) {
  if (typeof window === "undefined") return;

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }

  try {
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch {}
      speechRecognition = null;
    }

    const recognition = new SpeechRecognition();
    speechRecognition = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = getSpeechRecognitionLang(_config.language);

    let captured = false;

    recognition.onresult = (event: any) => {
      captured = true;
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript && transcript.trim()) {
        events.onTranscript?.("user", transcript.trim());
        onSpeechResult(transcript.trim());
      }
    };

    recognition.onerror = (err: any) => {
      // If error is no-speech and nothing was captured, safely try listening again
      if (err.error === "no-speech" && !captured && speechRecognition === recognition) {
        setTimeout(() => {
          if (speechRecognition === recognition) {
            try {
              recognition.start();
            } catch {}
          }
        }, 500);
      }
    };

    recognition.start();
  } catch (err) {
    console.warn("Speech recognition start failed:", err);
  }
}

function listenUserVoice(config: WebCallConfig, events: VapiCallEvents) {
  listenUserVoiceLoop(config, events, async (transcript) => {
    await processUserResponseIntent(transcript, config, events);
  });
}

/**
 * Helper to parse custom snooze minutes from natural user responses across languages
 */
function parseSnoozeMinutes(text: string): number {
  const lower = text.toLowerCase();

  // 1. Check for specific common phrases
  if (lower.includes("half an hour") || lower.includes("அரை மணி") || lower.includes("आधा घंटा")) return 30;
  if (lower.includes("an hour") || lower.includes("one hour") || lower.includes("ஒரு மணி") || lower.includes("एक घंटा")) return 60;
  if (lower.includes("tomorrow") || lower.includes("next day") || lower.includes("நாளை") || lower.includes("कल")) return 1440;

  // 2. Regular expression for digit numbers: "5 min", "5 நிமிடம்", "5 मिनट", "5 minutos", etc.
  const digitMatch = lower.match(/(\d+)\s*(min|minute|minutes|hr|hour|hours|நிமி|நிமிடம்|நிமிஷம்|மணி|मिनट|घंटे|घंटा|minutos|horas)/i);
  if (digitMatch) {
    const val = parseInt(digitMatch[1], 10);
    const unit = digitMatch[2].toLowerCase();
    if (unit.startsWith("hr") || unit.startsWith("hour") || unit === "மணி" || unit.startsWith("घंट") || unit.startsWith("hora")) {
      return val * 60;
    }
    return val;
  }

  // 3. Check for word numbers across English, Tamil, Hindi, Spanish
  const wordNumbers: { [key: string]: number } = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    // Tamil
    ஒன்று: 1, இரண்டு: 2, மூன்று: 3, நான்கு: 4, ஐந்து: 5,
    பத்து: 10, பதினைந்து: 15, இருபது: 20, முப்பது: 30,
    // Hindi
    एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5,
    दस: 10, पंद्रह: 15, बीस: 20, तीस: 30,
    // Spanish
    uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    diez: 10, quince: 15, veinte: 20, treinta: 30,
  };

  const words = Object.keys(wordNumbers).join("|");
  const wordRegex = new RegExp(`\\b(${words})\\b\\s*(min|minute|minutes|hr|hour|hours|நிமிடம்|நிமிஷம்|மணி|मिनट|घंटा|minutos|horas)`, "i");
  const wordMatch = lower.match(wordRegex);
  if (wordMatch) {
    const val = wordNumbers[wordMatch[1].toLowerCase()];
    const unit = wordMatch[2].toLowerCase();
    if (unit.startsWith("hr") || unit.startsWith("hour") || unit === "மணி" || unit.startsWith("घंट") || unit.startsWith("hora")) {
      return val * 60;
    }
    return val;
  }

  // 4. Default busy/later fallbacks
  if (
    lower.includes("busy") ||
    lower.includes("outside") ||
    lower.includes("travelling") ||
    lower.includes("tired") ||
    lower.includes("later") ||
    lower.includes("snooze") ||
    lower.includes("அப்புறம்") ||
    lower.includes("வெளியே") ||
    lower.includes("बाद में") ||
    lower.includes("व्यस्त") ||
    lower.includes("después") ||
    lower.includes("ocupado")
  ) {
    return 30; // default 30 mins postpone
  }

  return 0;
}

/**
 * Intelligent Intent Parser for Rescheduling & AI Responses (Multilingual + ElevenLabs audio)
 */
export async function processUserResponseIntent(
  userText: string,
  config: WebCallConfig,
  events: VapiCallEvents
) {
  const lower = userText.toLowerCase();
  const lang = config.language || "en";

  // Reschedule intent parsing
  const snoozeMins = parseSnoozeMinutes(lower);

  if (snoozeMins > 0) {
    const formatted = await executeRescheduleReminder(config.reminderId, snoozeMins, config);
    events.onRescheduled?.(formatted, snoozeMins);

    let reply = `No problem! I have rescheduled your study reminder for ${formatted}. Get some rest and see you then!`;
    if (lang === "ta" || /[\u0B80-\u0BFF]/.test(lower)) {
      reply = `கண்டிப்பா! உங்கள் படிப்பு நினைவூட்டலை ${formatted}-க்கு மாற்றியுள்ளேன். பிறகு பேசலாம்!`;
    } else if (lang === "hi" || /[\u0900-\u097F]/.test(lower)) {
      reply = `कोई बात नहीं! मैंने आपकी पढ़ाई का समय ${formatted} बजे के लिए रीशेड्यूल कर दिया है। बाद में मिलते हैं!`;
    }

    try {
      const synth = await synthesizeSpeechServerFn({ data: { text: reply } });
      if (synth.audioBase64) {
        events.onTranscript?.("assistant", reply);
        playAudioBase64(synth.audioBase64, events, () => {
          setTimeout(() => events.onStatusChange?.("ended"), 1200);
        });
        return;
      }
    } catch {}

    speakText(reply, events, () => {
      setTimeout(() => events.onStatusChange?.("ended"), 2000);
    }, lang);
    return;
  }

  if (
    lower.includes("motivate") || lower.includes("not motivated") || lower.includes("can't focus") ||
    lower.includes("பயமா") || lower.includes("மூட் இல்ல") || lower.includes("हिम्मत")
  ) {
    let reply = `You've got this! Small steps every day add up to massive achievements. Just spend 10 focused minutes on ${config.reminderTitle || "your study"} now!`;
    if (lang === "ta" || /[\u0B80-\u0BFF]/.test(lower)) {
      reply = `உங்களால் நிச்சயம் முடியும்! தினமும் செய்யும் சிறிய முயற்சி பெரிய வெற்றியைத் தரும். உடனே ஆரம்பியுங்கள்!`;
    } else if (lang === "hi" || /[\u0900-\u097F]/.test(lower)) {
      reply = `आप कर सकते हैं! हर दिन के छोटे कदम बड़ी सफलता लाते हैं। बस 10 मिनट के लिए पढ़ाई शुरू करें!`;
    }

    try {
      const synth = await synthesizeSpeechServerFn({ data: { text: reply } });
      if (synth.audioBase64) {
        events.onTranscript?.("assistant", reply);
        playAudioBase64(synth.audioBase64, events);
        return;
      }
    } catch {}

    speakText(reply, events, undefined, lang);
    return;
  }

  if (
    lower.includes("study now") || lower.includes("start now") || lower.includes("ready") || lower.includes("yes") ||
    lower.includes("தயார்") || lower.includes("படிக்கிறேன்") || lower.includes("हाँ") || lower.includes("तैयार")
  ) {
    let reply = `Awesome energy! I'll let you focus. Have a fantastic study session!`;
    if (lang === "ta" || /[\u0B80-\u0BFF]/.test(lower)) {
      reply = `அருமை! நீங்கள் கவனமாகப் படியுங்கள். வாழ்த்துகள்!`;
    } else if (lang === "hi" || /[\u0900-\u097F]/.test(lower)) {
      reply = `बहुत बढ़िया! अब आप ध्यान लगाकर पढ़ाई करें। ऑल द बेस्ट!`;
    }

    try {
      const synth = await synthesizeSpeechServerFn({ data: { text: reply } });
      if (synth.audioBase64) {
        events.onTranscript?.("assistant", reply);
        playAudioBase64(synth.audioBase64, events, () => {
          setTimeout(() => events.onStatusChange?.("ended"), 1200);
        });
        return;
      }
    } catch {}

    speakText(reply, events, () => {
      setTimeout(() => events.onStatusChange?.("ended"), 2000);
    }, lang);
    return;
  }

  // Generic encouraging AI response
  let genericReply = `Got it! Let's conquer ${config.reminderTitle || "this topic"}. I'm right here with you whenever you need help!`;
  if (lang === "ta" || /[\u0B80-\u0BFF]/.test(lower)) {
    genericReply = `சரிங்க! உங்கள் பாடத்தை ஆரம்பிக்கலாம். உங்களுக்கு உதவ நான் எப்போதும் தயார்!`;
  } else if (lang === "hi" || /[\u0900-\u097F]/.test(lower)) {
    genericReply = `ठीक है! चलिए पढ़ाई शुरू करते हैं। मैं हमेशा आपकी मदद के लिए यहाँ हूँ!`;
  }

  try {
    const synth = await synthesizeSpeechServerFn({ data: { text: genericReply } });
    if (synth.audioBase64) {
      events.onTranscript?.("assistant", genericReply);
      playAudioBase64(synth.audioBase64, events);
      return;
    }
  } catch {}

  speakText(genericReply, events, undefined, lang);
}
