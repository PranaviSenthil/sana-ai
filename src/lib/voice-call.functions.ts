import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { getGroqModel } from "./ai-groq.server";

const WebCallTurnInputSchema = z.object({
  reminderTitle: z.string().optional().default("Study Session"),
  topic: z.string().optional().default("General Revision"),
  userName: z.string().optional().default(""),
  persona: z.string().optional().default("friendly_coach"),
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
}

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

  const systemPrompt = `You are Sana, a real-time AI study companion on a voice phone call with ${studentName}.
Your personality is ${style}.
The student scheduled a study session for: "${reminderTitle}" (Topic: ${topic}).

CRITICAL SPOKEN CONVERSATION RULES:
1. Speak like a real human on a live phone call: use short, natural, spoken sentences (1-2 sentences, maximum 25 words per response).
2. NEVER use markdown formatting (no asterisks, bold, lists), NO emojis, and NO symbols. Your response is converted directly to audio by a Text-to-Speech engine.
3. Keep the conversation dynamic and interactive. When answering, leave room for the student to reply by ending with a short question unless ending the call.

INTENT HANDLING:
- RESCHEDULE / SNOOZE: If the student asks to call back later, reschedule, or mentions a time delay (e.g., "call me after 5 minutes", "remind me in 10 mins", "I'm busy right now, call later", "snooze for 15 mins", "after half an hour"):
  * Acknowledge warmly and confirm the callback time.
  * On the very last line of your output, output ONLY: SCHEDULE_FOLLOWUP:<minutes>
  * Example:
    No problem at all! Take your time and I will call you back in 5 minutes.
    SCHEDULE_FOLLOWUP:5

- READY TO STUDY: If the student says they are ready to study now, or starting now:
  * Wish them a great session with positive energy.
  * On the very last line of your output, output ONLY: END_CALL

- END CALL: If the student says bye, thank you, or wants to hang up:
  * Say a brief warm goodbye.
  * On the very last line of your output, output ONLY: END_CALL

- QUESTIONS / MOTIVATION / CHAT:
  * Answer directly, motivate them, and ask an engaging follow-up to guide them into studying.`;

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

    return parseWebCallResponse(text);
  } catch (err) {
    console.warn("Groq voice generation error, using fallback parser:", err);
    // Fallback parser if API fails or network glitch
    const lastUserMsg = messages[messages.length - 1]?.content || "";
    return generateFallbackTurn(lastUserMsg, reminderTitle);
  }
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
