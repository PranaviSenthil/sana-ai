import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, generateObject, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { NotebookDocSchema, type NotebookDoc } from "./study-notes.schema";

const SYSTEM = `You are Sana — an elite university tutor who prepares handwritten-style study notes for exam revision.

Do not simply convert AI text into notes. Act as an expert note-maker. Before rendering, reorganize the content into the most effective learning order: Topic → Definition → Why it matters → Visual analogy → Example → Code (if applicable) → Common mistakes → Memory trick → Quick revision → Practice questions → Summary. The renderer should optimize for learning, not just formatting.

Follow this pedagogical order strictly (skip any block that genuinely does not apply — never invent facts):
1. section "Introduction"       → paragraph (short lead-in)
2. definition                    → the core term + one-sentence textbook definition
3. why                           → "Why it matters" — one short paragraph
4. analogy                       → a vivid visual analogy the student can picture
5. section "Explanation"         → paragraph(s) of plain-English explanation
6. example                       → one concrete example
7. code (if code was in the reply) → language + code + output + one-line explanation
8. section "Common Mistakes"     → mistake block (2–5 bullet items)
9. memory                        → one vivid mnemonic ("Remember: …")
10. section "Quick Revision"     → revision block (3–6 tight bullets)
11. section "Practice"           → quiz_mcq + quiz_tf + quiz_fill (one of each when the topic supports it)
12. summary                      → 1–2 sentence takeaway

HARD RULES:
- PRESERVE every fact from the original reply. Do NOT add unrelated info.
- Strip ALL markdown syntax (#, *, -, >, backticks around inline code, tables). Convert into the correct block kind.
- Keep paragraphs short (≤ 3 sentences). Prefer checklist / revision / mistake blocks over prose when the reply is a list.
- "section" blocks are short titles (max 5 words). Use them as page dividers.
- code blocks: extract ONLY real code. "output" is the runtime output if shown, else null. "explanation" is one line, else null.
- checklist / revision / mistake items are ≤ 12 words each.
- formula.expr is the math/formula only. formula.label is what it computes.
- Always include at least one section block.
- Return valid blocks matching the schema. Never return raw markdown as a paragraph.`;

function fallbackDoc(topic: string, markdown: string): NotebookDoc {
  return {
    title: topic.slice(0, 80) || "Study Note",
    subtitle: null,
    blocks: [
      { kind: "section", text: "Notes" },
      { kind: "paragraph", text: markdown.slice(0, 4000) },
    ],
  };
}

export const structureStudyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        messageId: z.string(),
        threadId: z.string().nullable(),
        userQuestion: z.string(),
        assistantMarkdown: z.string(),
        style: z.string().default("ruled"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Cache
    const { data: existing } = await supabase
      .from("study_notes")
      .select("*")
      .eq("user_id", userId)
      .eq("message_id", data.messageId)
      .maybeSingle();
    if (existing) {
      const parsed = NotebookDocSchema.safeParse(existing.structured);
      if (parsed.success) {
        return { cached: true, doc: parsed.data, style: existing.style };
      }
      // Legacy row — fall through and regenerate.
    }

    const { getGroqModel } = await import("./ai-groq.server");
    const model = getGroqModel();

    let doc: NotebookDoc;
    try {
      const { object } = await generateObject({
        model,
        system: SYSTEM,
        prompt: `USER QUESTION:\n${data.userQuestion}\n\nASSISTANT REPLY (markdown to restructure — preserve facts, strip markdown, reorder for learning):\n${data.assistantMarkdown}`,
        schema: NotebookDocSchema,
        maxRetries: 1, // Don't retry infinitely if model struggles
      });
      doc = object;
    } catch (err) {
      console.warn("[study-notes] Object generation failed, using fallback doc:", err);
      doc = fallbackDoc(data.userQuestion || "Study Note", data.assistantMarkdown);
    }

    await supabase.from("study_notes").upsert(
      {
        user_id: userId,
        thread_id: data.threadId,
        message_id: data.messageId,
        topic: doc.title,
        style: data.style,
        structured: doc as never,
        markdown: data.assistantMarkdown,
      } as never,
      { onConflict: "user_id,message_id" },
    );

    return { cached: false, doc, style: data.style };
  });

export const getStudyPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("onboarding_preferences")
      .select("study_view_enabled, study_style")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      enabled: data?.study_view_enabled ?? false,
      style: (data?.study_style as string) ?? "ruled",
    };
  });

export const setStudyPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        enabled: z.boolean().optional(),
        style: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = { user_id: userId };
    if (typeof data.enabled === "boolean") patch.study_view_enabled = data.enabled;
    if (data.style) patch.study_style = data.style;
    await supabase
      .from("onboarding_preferences")
      .upsert(patch as never, { onConflict: "user_id" });
    return { ok: true };
  });
