import { createFileRoute } from "@tanstack/react-router";
import { smoothStream, streamText, type UIMessage } from "ai";
import { getGroqModel, getGroqVisionModel } from "@/lib/ai-groq.server";
import { systemPromptFor, type AiPersonality } from "@/lib/sana";
import { downloadAndParseFile } from "@/lib/file-parser.server";

type Body = {
  messages?: UIMessage[];
  personality?: AiPersonality;
  displayName?: string | null;
  videoContext?: string | null;
  classroomContext?: string | null;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { messages, personality, displayName, videoContext, classroomContext } =
            (await request.json()) as Body;
          if (!Array.isArray(messages)) return new Response("messages required", { status: 400 });

          const baseSystem = systemPromptFor(personality ?? "friendly_coach", displayName ?? null);
          let system = baseSystem;
          if (videoContext) {
            system += `

You have access to transcript excerpts from the YouTube video(s) the user is currently studying. Use them as your primary source of truth. When you reference a fact from the video, cite the timestamp inline using the exact markdown link format provided (e.g. [02:14](https://youtu.be/ID?t=134)). If the answer is not in the excerpts, say so clearly and offer the closest related context.

--- VIDEO TRANSCRIPT EXCERPTS ---
${videoContext}
--- END EXCERPTS ---`;
          }
          if (classroomContext === "__NO_MATCHES__") {
            system += `

A background search over the user's Google Classroom returned no relevant excerpts.
IMPORTANT: Since the user is asking about specific course documents, syllabi, module/unit names, or class materials, you MUST state clearly: "I couldn't find the requested document or syllabus in your synchronized Google Classroom materials. Please make sure your Google Classroom is connected and synced." Do NOT guess, simulate, or generate syllabus structures, module names, or assignments using your own general knowledge.`;
          } else if (classroomContext) {
            system += `

You have retrieved excerpts from the student's Google Classroom (assignments, announcements, materials, and course documents). These are your ONLY authoritative source for anything about the student's specific classes, homework, deadlines, teacher instructions, or lecture content.

Grounding rules — follow strictly:
1. Only claim classroom-specific facts that are directly supported by the excerpts below. Do NOT invent, rename, simplify, or modify official titles, module names, or syllabus units. Preserve the exact spelling.
2. Cite every classroom claim inline as a markdown link using the exact title and URL provided, e.g. [Unit 5 Notes](https://docs.google.com/...). If a source has no URL, cite the title in bold.
3. If the excerpts partially answer the question, answer only the supported part and say clearly what is missing.
4. If the excerpts do not contain the actual syllabus module names, state clearly that you found the document but the modules are not in the retrieved sections. Do NOT guess or substitute module names using general knowledge.
5. Never mix general knowledge with a classroom citation.

--- CLASSROOM EXCERPTS ---
${classroomContext}
--- END EXCERPTS ---`;
          }
          
          // Parse messages and extract images/docs
          const processedMessages = await Promise.all(messages.map(async (m: any) => {
            let text = m.parts?.map((p: any) => p.type === "text" ? p.text : "").join("") || m.content || "";
            
            // Look for attached files in text: [KIND attached: name — url]
            const attachRegex = /\[(Image|[A-Z]+) attached: (.*?) — (https?:\/\/[^\]]+)\]/g;
            const matches = [...text.matchAll(attachRegex)];
            
            for (const match of matches) {
              const [fullMatch, rawKind, name, url] = match;
              const kind = rawKind.toLowerCase();
              
              if (kind === "image") {
                const imgPlaceholder = `\n\n[Attached Image: ${name}]\n\n`;
                text = text.replace(fullMatch, imgPlaceholder).trim();
              } else {
                // It's a document. Download and parse it.
                const fileContent = await downloadAndParseFile(url, kind);
                const docContext = `\n\n--- DOCUMENT: ${name} ---\n${fileContent}\n--- END DOCUMENT ---\n\n`;
                text = text.replace(fullMatch, docContext).trim();
              }
            }
            
            return { role: m.role, content: text };
          }));

          const model = getGroqModel();
            
          const result = streamText({
            model,
            system,
            messages: processedMessages,
            abortSignal: request.signal,
            experimental_transform: smoothStream({ delayInMs: 10 }),
          });
          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            sendReasoning: false,
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              Connection: "keep-alive",
            },
          });
        } catch (err) {
          console.error("chat api error", err);
          const msg = err instanceof Error ? err.message : "unknown error";
          return new Response(`AI error: ${msg}`, { status: 500 });
        }
      },
    },
  },
});
