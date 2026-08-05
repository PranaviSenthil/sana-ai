import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { queryPg } from "./pg-client";

/**
 * Phase 3 — Document pipeline.
 *
 * 1. discoverClassroomDocuments: walks synced coursework/materials/announcements
 *    for the given courses, collects every Drive/Docs/Slides attachment, and
 *    upserts a `classroom_documents` row (status='pending') per file.
 * 2. indexNextClassroomDocuments: processes a small batch of pending documents —
 *    fetches text via Drive export / Docs / Slides APIs, chunks, embeds via the
 *    Lovable AI Gateway, and stores chunks in `classroom_chunks`.
 * 3. getClassroomIndexStats: quick counts for the UI.
 *
 * The UI calls (1) once, then repeatedly calls (2) until `remaining` hits 0,
 * driving an animated progress bar.
 */

type ConnRow = { access_token: string; refresh_token: string | null; token_expires_at: string | null };

async function loadConn(supabase: any, userId: string): Promise<ConnRow> {
  const { data, error } = await supabase
    .from("classroom_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Not connected to Google Classroom");
  return data as ConnRow;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth env missing");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidAccessToken(supabase: any, userId: string): Promise<string> {
  const conn = await loadConn(supabase, userId);
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (exp && exp - Date.now() > 60_000) return conn.access_token;
  if (!conn.refresh_token) throw new Error("Google session expired. Please reconnect.");
  const r = await refreshAccessToken(conn.refresh_token);
  const newExp = new Date(Date.now() + r.expires_in * 1000).toISOString();
  await supabase
    .from("classroom_connections")
    .update({ access_token: r.access_token, token_expires_at: newExp })
    .eq("user_id", userId);
  return r.access_token;
}

// ─────────────────────────── Discovery ───────────────────────────

type MaterialAttachment = {
  driveFile?: { driveFile?: { id: string; title?: string; alternateLink?: string } };
};

function extractDriveFiles(
  materials: unknown,
): Array<{ id: string; title: string; alternateLink?: string }> {
  if (!Array.isArray(materials)) return [];
  const out: Array<{ id: string; title: string; alternateLink?: string }> = [];
  for (const m of materials as MaterialAttachment[]) {
    const df = m?.driveFile?.driveFile;
    if (df?.id) {
      out.push({
        id: df.id,
        title: df.title || "Untitled",
        alternateLink: df.alternateLink,
      });
    }
  }
  return out;
}

export const discoverClassroomDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    if (!data.courseIds.length) return { discovered: 0 };

    const { supabase, userId } = context;

    // Pull everything that could carry an attachment for these courses.
    const [cwRes, matRes, anRes] = await Promise.all([
      supabase
        .from("classroom_coursework")
        .select("google_course_id, google_coursework_id, materials")
        .eq("user_id", userId)
        .in("google_course_id", data.courseIds),
      supabase
        .from("classroom_materials")
        .select("google_course_id, google_material_id, materials")
        .eq("user_id", userId)
        .in("google_course_id", data.courseIds),
      supabase
        .from("classroom_announcements")
        .select("google_course_id, google_announcement_id, materials")
        .eq("user_id", userId)
        .in("google_course_id", data.courseIds),
    ]);

    type DocRow = {
      user_id: string;
      google_course_id: string;
      source_type: string;
      source_id: string;
      drive_file_id: string;
      title: string;
      alternate_link: string | null;
    };
    const rows: DocRow[] = [];
    const seen = new Set<string>();
    const push = (
      courseId: string,
      sourceType: string,
      sourceId: string,
      files: ReturnType<typeof extractDriveFiles>,
    ) => {
      for (const f of files) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        rows.push({
          user_id: userId,
          google_course_id: courseId,
          source_type: sourceType,
          source_id: sourceId,
          drive_file_id: f.id,
          title: f.title,
          alternate_link: f.alternateLink ?? null,
        });
      }
    };

    for (const r of cwRes.data ?? []) {
      push(r.google_course_id, "coursework", r.google_coursework_id, extractDriveFiles(r.materials));
    }
    for (const r of matRes.data ?? []) {
      push(r.google_course_id, "material", r.google_material_id, extractDriveFiles(r.materials));
    }
    for (const r of anRes.data ?? []) {
      push(r.google_course_id, "announcement", r.google_announcement_id, extractDriveFiles(r.materials));
    }

    if (!rows.length) return { discovered: 0 };

    // Insert only new rows; leave existing (indexed) documents untouched.
    const { error } = await supabase
      .from("classroom_documents")
      .upsert(rows, { onConflict: "user_id,drive_file_id", ignoreDuplicates: true });
    if (error) throw error;

    return { discovered: rows.length };
  });

// ─────────────────────────── Fetch + extract ───────────────────────────

async function driveMeta(token: string, fileId: string) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive meta ${res.status}`);
  return res.json() as Promise<{ id: string; name: string; mimeType: string }>;
}

async function fetchDocsText(token: string, fileId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${fileId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new Error(`Docs API ${res.status}`);
    }
    const doc = await res.json();
    const body = doc.body;
    if (!body || !body.content) return "";
    
    const textParts: string[] = [];
    
    for (const element of body.content) {
      if (element.paragraph) {
        const paragraph = element.paragraph;
        let pText = "";
        if (paragraph.elements) {
          for (const el of paragraph.elements) {
            if (el.textRun?.content) {
              pText += el.textRun.content;
            }
          }
        }
        
        const style = paragraph.paragraphStyle?.namedStyleType;
        if (style && style.startsWith("HEADING_")) {
          const level = style.replace("HEADING_", "");
          const prefix = "#".repeat(Math.max(1, Math.min(6, parseInt(level) || 1)));
          textParts.push(`\n${prefix} ${pText.trim()}\n`);
        } else {
          textParts.push(pText);
        }
      } else if (element.table) {
        const table = element.table;
        for (const row of table.tableRows || []) {
          const rowCells: string[] = [];
          for (const cell of row.tableCells || []) {
            let cellText = "";
            for (const cellEl of cell.content || []) {
              if (cellEl.paragraph?.elements) {
                for (const el of cellEl.paragraph.elements) {
                  if (el.textRun?.content) cellText += el.textRun.content;
                }
              }
            }
            rowCells.push(cellText.trim().replace(/\n/g, " "));
          }
          textParts.push(`| ${rowCells.join(" | ")} |`);
        }
      }
    }
    
    const output = textParts.join("").replace(/\n{3,}/g, "\n\n");
    if (output.trim()) return output;
  } catch (err) {
    console.warn(`Docs API parsing failed, falling back to Drive plain text export:`, err);
  }

  // Fallback to plain text Drive export
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Docs export fallback failed: ${res.status}`);
  return res.text();
}

async function fetchSlidesText(token: string, fileId: string): Promise<string> {
  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slides ${res.status}`);
  const json = (await res.json()) as {
    slides?: Array<{
      pageElements?: Array<{
        shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } };
      }>;
    }>;
  };
  const parts: string[] = [];
  (json.slides ?? []).forEach((slide, i) => {
    parts.push(`--- Slide ${i + 1} ---`);
    for (const el of slide.pageElements ?? []) {
      for (const te of el.shape?.text?.textElements ?? []) {
        const t = te.textRun?.content;
        if (t) parts.push(t);
      }
    }
  });
  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function fetchSheetsText(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets export ${res.status}`);
  return res.text();
}

async function fetchPlainDrive(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive media ${res.status}`);
  return res.text();
}

const SUPPORTED_PLAIN_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
]);

async function fetchPdfText(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive media PDF download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Dynamic import to prevent client-side bundler crashes
  const pdfParse = (await import("pdf-parse")).default;
  const parsed = await pdfParse(buffer);
  return parsed.text;
}

async function fetchDocumentText(
  token: string,
  fileId: string,
): Promise<{ text: string; mimeType: string; title: string } | { skipped: true; mimeType: string; title: string }> {
  const meta = await driveMeta(token, fileId);
  const mt = meta.mimeType;
  if (mt === "application/vnd.google-apps.document") {
    return { text: await fetchDocsText(token, fileId), mimeType: mt, title: meta.name };
  }
  if (mt === "application/vnd.google-apps.presentation") {
    return { text: await fetchSlidesText(token, fileId), mimeType: mt, title: meta.name };
  }
  if (mt === "application/vnd.google-apps.spreadsheet") {
    return { text: await fetchSheetsText(token, fileId), mimeType: mt, title: meta.name };
  }
  if (SUPPORTED_PLAIN_MIMES.has(mt)) {
    return { text: await fetchPlainDrive(token, fileId), mimeType: mt, title: meta.name };
  }
  if (mt === "application/pdf" || meta.name.toLowerCase().endsWith(".pdf")) {
    try {
      const text = await fetchPdfText(token, fileId);
      return { text, mimeType: mt, title: meta.name };
    } catch (pdfErr) {
      console.error(`[RAG Indexer] Failed to parse PDF ${fileId}:`, pdfErr);
      return { skipped: true, mimeType: mt, title: meta.name };
    }
  }
  // images, Office docs, videos: skip in Phase 3.
  return { skipped: true, mimeType: mt, title: meta.name };
}

// ─────────────────────────── Chunking ───────────────────────────

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= CHUNK_SIZE) return [cleaned];

  const chunks: string[] = [];
  const lines = cleaned.split("\n");
  let currentChunk = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = line.startsWith("#") || /^(?:module|unit|chapter|section)\s+\d+/i.test(line.trim()) || /^[A-Z0-9\s,&-]{10,60}$/.test(line.trim());
    
    if (isHeading && currentChunk.length > 300) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      if (currentChunk) {
        if ((currentChunk + "\n" + line).length > CHUNK_SIZE) {
          chunks.push(currentChunk.trim());
          const overlapLines = currentChunk.split("\n").slice(-2).join("\n");
          currentChunk = overlapLines + "\n" + line;
        } else {
          currentChunk += "\n" + line;
        }
      } else {
        currentChunk = line;
      }
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Hard-split any oversized chunk (e.g. dense CSVs).
  const out: string[] = [];
  for (const c of chunks) {
    if (c.length <= CHUNK_SIZE) {
      out.push(c);
    } else {
      for (let i = 0; i < c.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        out.push(c.slice(i, i + CHUNK_SIZE));
      }
    }
  }
  return out;
}

// ─────────────────────────── Embedding ───────────────────────────

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
        const ordered = new Array<number[]>(inputs.length);
        for (const d of json.data) ordered[d.index] = d.embedding;
        return ordered;
      } else {
        console.warn(`[RAG Embed] OpenAI batch failed with status ${res.status}. Falling back to Gemini...`);
      }
    } catch (e) {
      console.warn("[RAG Embed] OpenAI batch failed. Falling back to Gemini...", e);
    }
  }

  if (!geminiApiKey) {
    throw new Error("Both OPENAI_API_KEY and GEMINI_API_KEY are missing or failed.");
  }

  // Gemini batchEmbedContents API
  const requests = inputs.map((text) => ({
    model: "models/text-embedding-004",
    content: { parts: [{ text }] }
  }));

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${geminiApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini Batch Embed failed: ${res.status} - ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { embeddings: Array<{ values: number[] }> };
  const embeddings = json.embeddings;
  if (!embeddings || !embeddings.length) throw new Error("Empty Gemini batch embedding response");

  return embeddings.map((e) => {
    const padded = [...e.values];
    while (padded.length < 1536) padded.push(0.0);
    return padded;
  });
}

// ─────────────────────────── Indexer step ───────────────────────────

const BATCH_DOCS = 3;      // process at most 3 documents per call
const EMBED_BATCH = 32;    // ≤ 100 for Gemini; keep well under limits

export const getClassroomIndexStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [pendingRes, indexedRes, skippedRes, errorRes] = await Promise.all([
      context.supabase.from("classroom_documents").select("id", { count: "exact", head: true }).eq("user_id", context.userId).eq("status", "pending"),
      context.supabase.from("classroom_documents").select("id", { count: "exact", head: true }).eq("user_id", context.userId).eq("status", "indexed"),
      context.supabase.from("classroom_documents").select("id", { count: "exact", head: true }).eq("user_id", context.userId).eq("status", "skipped"),
      context.supabase.from("classroom_documents").select("id", { count: "exact", head: true }).eq("user_id", context.userId).eq("status", "error"),
    ]);
    
    // Count chunks from local PostgreSQL or Supabase
    let chunks = 0;
    const usePg = !!process.env.DATABASE_URL;
    if (usePg) {
      try {
        const pgRes = await queryPg("SELECT COUNT(*)::int AS count FROM classroom_chunks WHERE user_id = $1", [context.userId]);
        chunks = pgRes.rows[0]?.count ?? 0;
      } catch (pgErr) {
        console.error("[RAG Indexer] Failed to count pg chunks:", pgErr);
      }
    } else {
      try {
        const { count: sbCount } = await context.supabase
          .from("classroom_chunks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId);
        chunks = sbCount ?? 0;
      } catch (sbErr) {
        console.error("[RAG Indexer] Failed to count Supabase chunks:", sbErr);
      }
    }

    return {
      pending: pendingRes.count ?? 0,
      indexed: indexedRes.count ?? 0,
      skipped: skippedRes.count ?? 0,
      errored: errorRes.count ?? 0,
      chunks,
    };
  });

export const indexNextClassroomDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const usePg = !!process.env.DATABASE_URL;

    // Self-healing check: Reset status of documents that are marked as 'indexed' but have no chunks in the active database
    try {
      const { data: indexedDocs } = await supabase
        .from("classroom_documents")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "indexed");

      if (indexedDocs && indexedDocs.length > 0) {
        const docIds = indexedDocs.map((d: any) => d.id);
        let activeDocIds: string[] = [];

        if (usePg) {
          try {
            const pgRes = await queryPg(
              "SELECT DISTINCT document_id::text FROM classroom_chunks WHERE user_id = $1 AND document_id = ANY($2)",
              [userId, docIds]
            );
            activeDocIds = pgRes.rows.map((r: any) => r.document_id);
          } catch (pgErr) {
            console.error("[RAG Self-Heal] Failed to query active pg doc chunks:", pgErr);
          }
        } else {
          try {
            const { data: chunkRows } = await supabase
              .from("classroom_chunks")
              .select("document_id")
              .eq("user_id", userId)
              .in("document_id", docIds);
            if (chunkRows) {
              activeDocIds = Array.from(new Set(chunkRows.map((c: any) => c.document_id)));
            }
          } catch (sbErr) {
            console.error("[RAG Self-Heal] Failed to query active Supabase doc chunks:", sbErr);
          }
        }

        const missingDocIds = docIds.filter((id: string) => !activeDocIds.includes(id));
        if (missingDocIds.length > 0) {
          console.log(`[RAG Self-Heal] Resetting ${missingDocIds.length} 'indexed' documents with 0 chunks to 'pending'`);
          await supabase
            .from("classroom_documents")
            .update({ status: "pending", error: null })
            .in("id", missingDocIds);
        }
      }

      // Self-healing: Reset previously skipped PDFs to 'pending' so we can extract their text using pdf-parse!
      const { data: skippedPdfs } = await supabase
        .from("classroom_documents")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "skipped")
        .or("mime_type.eq.application/pdf,title.ilike.%.pdf");

      if (skippedPdfs && skippedPdfs.length > 0) {
        const skippedIds = skippedPdfs.map((d: any) => d.id);
        console.log(`[RAG Self-Heal] Resetting ${skippedIds.length} skipped PDF documents to 'pending' for processing`);
        await supabase
          .from("classroom_documents")
          .update({ status: "pending", error: null })
          .in("id", skippedIds);
      }
    } catch (shErr) {
      console.warn("[RAG Self-Heal] Warning: self-healing check failed:", shErr);
    }

    const { data: pending, error } = await supabase
      .from("classroom_documents")
      .select("id, drive_file_id, title")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_DOCS);
    if (error) throw error;
    if (!pending?.length) {
      return { processed: 0, remaining: 0 };
    }

    const token = await getValidAccessToken(supabase, userId);

    let processed = 0;
    for (const doc of pending) {
      try {
        console.log(`[RAG Indexer] Starting indexing operation for:\n- Document ID: ${doc.id}\n- Google File ID: ${doc.drive_file_id}\n- Document Title: ${doc.title}`);

        const fetched = await fetchDocumentText(token, doc.drive_file_id);
        if ("skipped" in fetched) {
          console.log(`[RAG Indexer] Document ${doc.id} skipped. MIME type: ${fetched.mimeType}`);
          await supabase
            .from("classroom_documents")
            .update({
              status: "skipped",
              mime_type: fetched.mimeType,
              title: fetched.title,
              error: `Unsupported MIME type: ${fetched.mimeType}`,
              indexed_at: new Date().toISOString(),
            })
            .eq("id", doc.id);
          processed += 1;
          continue;
        }

        console.log(`[RAG Indexer] Document extracted successfully:\n- MIME Type: ${fetched.mimeType}\n- Character Count: ${fetched.text.length}`);

        const chunks = chunkText(fetched.text);
        if (!chunks.length) {
          console.log(`[RAG Indexer] Document ${doc.id} skipped. Extracted content is empty.`);
          await supabase
            .from("classroom_documents")
            .update({
              status: "skipped",
              mime_type: fetched.mimeType,
              title: fetched.title,
              content_length: 0,
              error: "Empty document",
              indexed_at: new Date().toISOString(),
            })
            .eq("id", doc.id);
          processed += 1;
          continue;
        }

        console.log(`[RAG Indexer] Split document into ${chunks.length} chunks. Generating embeddings...`);

        // Embed in sub-batches.
        const embeddings: number[][] = [];
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch = chunks.slice(i, i + EMBED_BATCH);
          const vecs = await embedBatch(batch);
          embeddings.push(...vecs);
        }

        console.log(`[RAG Indexer] Embedding generation: SUCCESS (Generated ${embeddings.length} vectors of size 1536)`);

        // Fetch document metadata to store inline in PostgreSQL
        const { data: docRow } = await supabase
          .from("classroom_documents")
          .select("google_course_id, title, drive_file_id, source_type, alternate_link")
          .eq("id", doc.id)
          .maybeSingle();

        const courseId = docRow?.google_course_id ?? "";
        const docTitle = docRow?.title ?? doc.title;
        const driveFileId = docRow?.drive_file_id ?? doc.drive_file_id;
        const sourceType = docRow?.source_type ?? "document";
        const sourceUrl = docRow?.alternate_link ?? null;

        // Fetch course name
        const { data: courseRow } = await supabase
          .from("classroom_courses")
          .select("name")
          .eq("google_course_id", courseId)
          .eq("user_id", userId)
          .maybeSingle();
        const courseName = courseRow?.name ?? null;

        const usePg = !!process.env.DATABASE_URL;

        if (usePg) {
          // Clean out any old chunks for this document in PostgreSQL
          try {
            await queryPg("DELETE FROM classroom_chunks WHERE document_id = $1", [doc.id]);
          } catch (delErr) {
            console.warn("[RAG Indexer] Failed to delete old chunks in pg:", delErr);
          }

          // Insert new chunks into PostgreSQL using a single bulk insert
          if (chunks.length > 0) {
            const valuePlaceholders: string[] = [];
            const values: any[] = [];
            
            chunks.forEach((content, idx) => {
              const baseIdx = idx * 11;
              valuePlaceholders.push(`($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8}, $${baseIdx + 9}, $${baseIdx + 10}, $${baseIdx + 11})`);
              
              // Format embedding as pgvector array string: '[v1, v2, ...]'
              const embeddingStr = `[${embeddings[idx].join(",")}]`;
              
              values.push(
                userId,
                courseId,
                doc.id,
                driveFileId,
                docTitle,
                courseName,
                sourceType,
                sourceUrl,
                idx, // chunk_index
                content,
                embeddingStr
              );
            });
            
            const insertSql = `INSERT INTO classroom_chunks (user_id, course_id, document_id, google_file_id, document_title, course_name, source_type, source_url, chunk_index, content, embedding) VALUES ${valuePlaceholders.join(", ")}`;
            
            try {
              await queryPg(insertSql, values);
              console.log(`[RAG Indexer] PostgreSQL Database insertion: SUCCESS (Inserted ${chunks.length} chunks)`);
            } catch (insErr) {
              console.error(`[RAG Indexer] PostgreSQL Database insertion: FAILED`, insErr);
              throw insErr;
            }
          }
        } else {
          // Fallback: Clean out old chunks and write new chunks to Supabase classroom_chunks!
          console.log(`[RAG Indexer] DATABASE_URL is missing. Falling back to Supabase for RAG storage...`);
          await supabase.from("classroom_chunks").delete().eq("document_id", doc.id);
          
          if (chunks.length > 0) {
            const chunkRows = chunks.map((content, idx) => ({
              user_id: userId,
              document_id: doc.id,
              google_course_id: courseId,
              chunk_index: idx,
              content,
              embedding: embeddings[idx] as unknown as string,
              token_estimate: Math.ceil(content.length / 4),
            }));

            const { error: insErr } = await supabase.from("classroom_chunks").insert(chunkRows as any);
            if (insErr) {
              console.error(`[RAG Indexer] Supabase Database insertion: FAILED`, insErr);
              throw insErr;
            }
            console.log(`[RAG Indexer] Supabase Database insertion: SUCCESS (Inserted ${chunkRows.length} chunks)`);
          }
        }

        await supabase
          .from("classroom_documents")
          .update({
            status: "indexed",
            mime_type: fetched.mimeType,
            title: fetched.title,
            content_length: fetched.text.length,
            chunk_count: chunks.length,
            error: null,
            indexed_at: new Date().toISOString(),
          })
          .eq("id", doc.id);

        console.log(`[RAG Indexer] Document ${doc.id} successfully indexed!`);
        processed += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Indexing failed";
        console.error(`[RAG Indexer] Document ${doc.id} indexing operation failed:`, msg);
        await supabase
          .from("classroom_documents")
          .update({ status: "error", error: msg.slice(0, 500), indexed_at: new Date().toISOString() })
          .eq("id", doc.id);
        processed += 1;
      }
    }

    const { count: remaining } = await supabase
      .from("classroom_documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending");

    return { processed, remaining: remaining ?? 0 };
  });
