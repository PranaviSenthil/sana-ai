import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { getGroqModel } from "./ai-groq.server";

const WebCallTurnInputSchema = z.object({
  reminderTitle: z.string().optional().default("Study Session"),
  topic: z.string().optional().default("General Revision"),
  userName: z.string().optional().default(""),
  persona: z.string().optional().default("friendly_coach"),
  language: z.string().optional().default("en"),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
});

export interface WebCallTurnResult {
  spokenText: string;
  rescheduleMinutes: number | null;
  endCall: boolean;
  audioBase64?: string | null;
}

/**
 * Server-side ElevenLabs Text-to-Speech synthesis with eleven_multilingual_v2
 * Keeps ELEVENLABS_API_KEY secure on the server.
 */
export async function generateElevenLabsTTS(text: string): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Sarah (friendly female voice)
    const cleanText = text
      .replace(/[*_~`#]/g, "")
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
      .trim();

    if (!cleanText) return null;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      console.warn("ElevenLabs TTS error status:", response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return base64;
  } catch (err) {
    console.warn("Failed to generate ElevenLabs TTS:", err);
    return null;
  }
}

/**
 * Dedicated server function to synthesize audio on demand
 */
export const synthesizeSpeechServerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ text: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ audioBase64: string | null }> => {
    const audioBase64 = await generateElevenLabsTTS(data.text);
    return { audioBase64 };
  });

export async function handleWebCallTurn(data: z.infer<typeof WebCallTurnInputSchema>): Promise<WebCallTurnResult> {
  const { reminderTitle, topic, userName, persona, messages } = data;
  const studentName = userName ? userName.trim() : "friend";

  const personaDescriptions: Record<string, string> = {
    friendly_coach: "warm, supportive, and motivating like a best study buddy",
    strict_mentor: "disciplined, direct, and focused on immediate action",
    mom_mode: "caring, gentle, nurturing, and making sure the student takes care of themselves",
    power_coach: "high-energy, hyped, enthusiastic, and pushing for greatness",
  };

  const style = personaDescriptions[persona] || personaDescriptions.friendly_coach;

  const systemPrompt = `You are Sana, a real-time multilingual AI study companion on a voice phone call with ${studentName}.
Your personality is ${style}.
The student scheduled a study session for: "${reminderTitle}" (Topic: ${topic}).

CRITICAL MULTILINGUAL INSTRUCTIONS:
1. Detect the language of the student's speech (English, Tamil, Hindi, Spanish, French, German, Telugu, Kannada, etc.).
2. ALWAYS respond in the EXACT SAME LANGUAGE that the student spoke to you in!
3. If the student speaks in Tanglish (Tamil written phonetically) or Hinglish, respond warmly in conversational, natural Tamil or Hindi.
4. Keep spoken responses short, natural, and conversational like a real human on a live phone call (1-2 sentences, maximum 25 words).
5. NEVER use markdown formatting (no asterisks, bold, lists), NO emojis, and NO symbols because this is read aloud by a voice model.

INTENT HANDLING:
- RESCHEDULE / SNOOZE: If the student asks to call back later, reschedule, or mentions any time delay in ANY language (e.g. "call me after 5 minutes", "5 நிமிஷம் கழிச்சு கூப்பிடு", "5 मिनट बाद कॉल करना", "llámame en 5 minutos", "rappelle-moi dans 5 minutes"):
  * Acknowledge warmly and confirm the callback time in the student's language.
  * On the very last line of your output, output ONLY: SCHEDULE_FOLLOWUP:<minutes>
  * Example:
    கண்டிப்பா! 5 நிமிஷம் கழிச்சு நான் திரும்ப கூப்பிடுறேன்.
    SCHEDULE_FOLLOWUP:5

- READY TO STUDY: If the student says they are ready to study now, or starting now (in any language):
  * Wish them a great session with positive energy in their language.
  * On the very last line of your output, output ONLY: END_CALL

- END CALL: If the student says bye, thank you, or wants to hang up:
  * Say a brief warm goodbye in their language.
  * On the very last line of your output, output ONLY: END_CALL

- QUESTIONS / MOTIVATION / CHAT:
  * Answer directly, motivate them, and ask an engaging follow-up to guide them into studying.`;

  let turnResult: WebCallTurnResult;

  try {
    const model = getGroqModel("groq/compound-mini");
    const { text } = await generateText({
      model,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.6,
    });

    turnResult = parseWebCallResponse(text);
  } catch (err) {
    console.warn("Groq voice generation error, using fallback parser:", err);
    const lastUserMsg = messages[messages.length - 1]?.content || "";
    turnResult = generateFallbackTurn(lastUserMsg, reminderTitle);
  }

  // Generate ElevenLabs audio for the response text
  const audioBase64 = await generateElevenLabsTTS(turnResult.spokenText);

  return {
    ...turnResult,
    audioBase64,
  };
}

export const generateWebCallTurn = createServerFn({ method: "POST" })
  .validator((d: unknown) => WebCallTurnInputSchema.parse(d))
  .handler(async ({ data }): Promise<WebCallTurnResult> => {
    return handleWebCallTurn(data);
  });

function parseWebCallResponse(raw: string): WebCallTurnResult {
  let rescheduleMinutes: number | null = null;
  let endCall = false;

  const lines = raw.split(/\r?\n/);
  const spokenLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const followUpMatch = /^\s*SCHEDULE_FOLLOWUP:\s*(\d+)\s*$/i.exec(trimmed);
    if (followUpMatch) {
      rescheduleMinutes = parseInt(followUpMatch[1], 10);
      endCall = true;
      continue;
    }
    if (/^\s*END_CALL\s*$/i.test(trimmed)) {
      endCall = true;
      continue;
    }
    if (trimmed) {
      spokenLines.push(trimmed);
    }
  }

  let spokenText = spokenLines.join(" ").replace(/[*_~`#]/g, "").replace(/\s+/g, " ").trim();
  if (!spokenText) {
    spokenText = "I hear you! Let's make today a great study day. Are you ready to dive in?";
  }

  return {
    spokenText,
    rescheduleMinutes,
    endCall,
  };
}

function generateFallbackTurn(userText: string, title: string): WebCallTurnResult {
  const lower = userText.toLowerCase();

  // Check for delay
  const digitMatch = lower.match(/(\d+)\s*(min|minute|minutes|hr|hour|hours)/i);
  if (digitMatch) {
    let mins = parseInt(digitMatch[1], 10);
    if (digitMatch[2].toLowerCase().startsWith("hr") || digitMatch[2].toLowerCase().startsWith("hour")) {
      mins *= 60;
    }
    return {
      spokenText: `Sure thing! I will reschedule your reminder and call you back in ${mins} minutes. See you then!`,
      rescheduleMinutes: mins,
      endCall: true,
    };
  }

  if (lower.includes("busy") || lower.includes("later") || lower.includes("outside") || lower.includes("tired")) {
    return {
      spokenText: "No worries at all! I will call you back in 15 minutes so you can take a breather.",
      rescheduleMinutes: 15,
      endCall: true,
    };
  }

  if (lower.includes("ready") || lower.includes("study now") || lower.includes("start") || lower.includes("yes")) {
    return {
      spokenText: `Awesome energy! Go crush your ${title} session. I will let you focus now!`,
      rescheduleMinutes: null,
      endCall: true,
    };
  }

  return {
    spokenText: `You have got this! Even 10 focused minutes on ${title} will make a huge difference. Ready to try?`,
    rescheduleMinutes: null,
    endCall: false,
  };
}
