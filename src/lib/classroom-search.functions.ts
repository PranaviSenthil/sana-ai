import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { queryPg } from "./pg-client";

/**
 * Phase 4 — RAG search over indexed classroom content.
 *
 * Embeds the query with the same model used at indexing time
 * (google/gemini-embedding-001, 3072-d) and calls the `match_classroom_chunks`
 * RPC to fetch the top-k most similar chunks for this user.
 */

export type ClassroomMatch = {
  chunkId: string;
  documentId: string;
  courseId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  documentTitle: string;
  alternateLink: string | null;
  courseName: string | null;
};

export type ClassroomSearchResult = {
  matches: ClassroomMatch[];
  timings: { embedMs: number; queryMs: number; totalMs: number };
  requested: { matchCount: number; courseIds: string[] | null; query: string };
};

async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
  });
  if (!res.ok) {
    throw new Error(`Embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!vec) throw new Error("Empty embedding response");
  return vec;
}

export type ClassroomDebug = {
  documentFound: boolean;
  documentId?: string;
  googleFileId?: string;
  documentTitle?: string;
  courseId?: string;
  courseName?: string;
  mimeType?: string;
  sourceUrl?: string;
  status?: string;
  chunkCount?: number;
  syllabusKeywordsFound?: boolean;
};

export const debugClassroomRAG = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<any> => {
    const { userId } = context;
    
    const report: any = {
      dbConnection: "FAIL",
      pgvectorExtension: "FAIL",
      syllabusDocFound: "NOT FOUND",
      chunksCount: 0,
      embeddingsPresent: "MISSING",
      embeddingDimension: "INVALID",
      moduleHeadingsFound: "NOT FOUND",
      vectorSearchTest: "FAIL",
      keywordSearchTest: "FAIL",
      retrievedCorrectChunk: "FAIL",
    };
    
    // 1. Verify DB Connection
    try {
      await queryPg("SELECT 1");
      report.dbConnection = "PASS";
    } catch (dbErr) {
      console.error("[RAG Debug] PostgreSQL connection failed:", dbErr);
      return report;
    }
    
    // 2. Verify pgvector extension
    try {
      const extRes = await queryPg("SELECT extname FROM pg_extension WHERE extname = 'vector'");
      if (extRes.rows.length > 0) {
        report.pgvectorExtension = "PASS";
      }
    } catch (extErr) {
      console.error("[RAG Debug] pgvector check failed:", extErr);
    }
    
    // 3. Search for Applied Cryptography syllabus chunks in local PostgreSQL
    let chunks: any[] = [];
    try {
      const chunksRes = await queryPg(
        `SELECT id, document_title, content, embedding IS NOT NULL as has_embedding 
         FROM classroom_chunks 
         WHERE user_id = $1 
           AND (document_title ILIKE '%applied cryptography%' OR content ILIKE '%cryptography%')
         ORDER BY chunk_index ASC`,
        [userId]
      );
      chunks = chunksRes.rows;
      report.chunksCount = chunks.length;
      if (chunks.length > 0) {
        report.syllabusDocFound = "FOUND";
        report.embeddingsPresent = chunks.every((c) => c.has_embedding) ? "PRESENT" : "PARTIAL/MISSING";
      }
    } catch (chunkErr) {
      console.error("[RAG Debug] Chunks retrieval failed:", chunkErr);
    }
    
    // 4. Verify embedding dimension if any chunk exists
    if (chunks.length > 0) {
      try {
        const dimRes = await queryPg(
          "SELECT vector_dims(embedding) AS dims FROM classroom_chunks WHERE id = $1",
          [chunks[0].id]
        );
        const dims = dimRes.rows[0]?.dims;
        if (dims === 1536) {
          report.embeddingDimension = "1536";
        } else {
          report.embeddingDimension = dims ? `INVALID (${dims})` : "INVALID";
        }
      } catch (dimErr) {
        console.error("[RAG Debug] Dimension check failed:", dimErr);
      }
    }
    
    // 5. Check if the 3 module headings exist in the text content
    const allContent = chunks.map((c) => c.content).join("\n").toUpperCase();
    const hasModule1 = allContent.includes("SYMMETRIC KEY CRYPTOGRAPHY AND BLOCKCIPHERS");
    const hasModule2 = allContent.includes("PUBLIC KEY CRYPTOGRAPHY AND DATA INTEGRITY ALGORITHMS");
    const hasModule3 = allContent.includes("DIGITAL SIGNATURES AND AUTHENTICATION APPLICATIONS");
    
    if (hasModule1 && hasModule2 && hasModule3) {
      report.moduleHeadingsFound = "FOUND";
    } else if (hasModule1 || hasModule2 || hasModule3) {
      report.moduleHeadingsFound = "PARTIAL";
    }
    
    // 6. Test Vector search (Local PostgreSQL pgvector)
    try {
      const fakeVec = Array(1536).fill(0.01);
      const vecString = `[${fakeVec.join(",")}]`;
      const searchRes = await queryPg(
        `SELECT id 
         FROM classroom_chunks 
         WHERE user_id = $2 
         ORDER BY embedding <=> $1 
         LIMIT 1`,
        [vecString, userId]
      );
      if (searchRes.rows.length > 0) {
        report.vectorSearchTest = "PASS";
      }
    } catch (vErr) {
      console.error("[RAG Debug] Vector search test failed:", vErr);
    }
    
    // 7. Test Keyword search
    try {
      const kwRes = await queryPg(
        `SELECT id FROM classroom_chunks 
         WHERE user_id = $1 
           AND (content ILIKE '%cryptography%' OR content ILIKE '%symmetric%') 
         LIMIT 1`,
        [userId]
      );
      if (kwRes.rows.length > 0) {
        report.keywordSearchTest = "PASS";
      }
    } catch (kwErr) {
      console.error("[RAG Debug] Keyword search test failed:", kwErr);
    }
    
    // 8. Test retrieved correct chunk & content matching
    if (chunks.length > 0) {
      const hasACKeywords = chunks.some(c => 
        c.content.toUpperCase().includes("SYMMETRIC KEY CRYPTOGRAPHY")
      );
      if (hasACKeywords) {
        report.retrievedCorrectChunk = "PASS";
      }
    }
    
    console.log("=== GCR LOCAL POSTGRES DIAGNOSTIC REPORT ===");
    console.log(JSON.stringify(report, null, 2));
    
    return report;
  });

export const searchClassroomChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { query: string; courseIds?: string[]; matchCount?: number }) => data,
  )
  .handler(async ({ data, context }): Promise<ClassroomSearchResult> => {
    const q = (data.query ?? "").trim();
    const matchCount = data.matchCount ?? 8;
    const courseIds = data.courseIds?.length ? data.courseIds : null;
    const empty: ClassroomSearchResult = {
      matches: [],
      timings: { embedMs: 0, queryMs: 0, totalMs: 0 },
      requested: { matchCount, courseIds, query: q },
    };
    if (!q) return empty;

    // Verify chunk presence in PostgreSQL
    let count = 0;
    try {
      const cntRes = await queryPg("SELECT COUNT(*)::int AS count FROM classroom_chunks WHERE user_id = $1", [context.userId]);
      count = cntRes.rows[0]?.count ?? 0;
    } catch (cntErr) {
      console.error("[RAG Search] Chunks count check failed:", cntErr);
    }
    if (!count) return empty;

    const t0 = performance.now();
    const embedding = await embedQuery(q);
    const t1 = performance.now();

    // Dynamic Acronym Expansion from user's actual courses:
    const tokens = q
      .toLowerCase()
      .split(/[\s,_.-]+/)
      .filter((w) => w.length > 1 && !["gcr", "from", "in", "syllabus", "notes", "classroom"].includes(w));
      
    try {
      const { data: userCourses } = await context.supabase
        .from("classroom_courses")
        .select("name")
        .eq("user_id", context.userId);

      if (userCourses && userCourses.length > 0) {
        for (const uc of userCourses) {
          const cleanName = uc.name.split(/[()]/)[0].replace(/[^a-zA-Z\s]/g, "").trim();
          const words = cleanName.split(/\s+/).filter((w) => w.length > 0);
          if (words.length > 1) {
            const acronym = words.map((w) => w[0].toLowerCase()).join("");
            if (tokens.includes(acronym)) {
              console.log(`[RAG Search] Dynamically expanded acronym "${acronym}" -> "${cleanName}"`);
              words.forEach((word) => {
                const wLower = word.toLowerCase();
                if (wLower.length > 2 && !tokens.includes(wLower)) {
                  tokens.push(wLower);
                }
              });
            }
          }
        }
      }
    } catch (acError) {
      console.warn("[RAG Search] Failed to dynamically expand acronyms:", acError);
    }

    const usePg = !!process.env.DATABASE_URL;

    // 1. Vector Search Query
    let semanticMatches: any[] = [];
    if (usePg) {
      try {
        let querySql = `SELECT id AS chunk_id, document_id, course_id AS google_course_id, chunk_index, content, 1 - (embedding <=> $1) AS similarity, document_title, source_url AS alternate_link, course_name FROM classroom_chunks WHERE user_id = $2 AND embedding IS NOT NULL`;
        const params: any[] = [`[${embedding.join(",")}]`, context.userId];
        let paramCount = 2;

        if (courseIds && courseIds.length > 0) {
          paramCount++;
          querySql += ` AND course_id = ANY($${paramCount})`;
          params.push(courseIds);
        }

        paramCount++;
        querySql += ` ORDER BY embedding <=> $1 LIMIT $${paramCount}`;
        params.push(matchCount);

        const pgResult = await queryPg(querySql, params);
        semanticMatches = pgResult.rows.map((row: any) => ({
          chunk_id: row.chunk_id,
          document_id: row.document_id,
          google_course_id: row.google_course_id,
          chunk_index: row.chunk_index,
          content: row.content,
          similarity: Number(row.similarity || 0),
          document_title: row.document_title,
          alternate_link: row.alternate_link,
          course_name: row.course_name
        }));
      } catch (pgErr) {
        console.error("[RAG Search] PostgreSQL vector query failed:", pgErr);
      }
    } else {
      // Supabase vector search using RPC match_classroom_chunks
      try {
        const { data: rows, error } = await context.supabase.rpc("match_classroom_chunks", {
          query_embedding: embedding as unknown as string,
          target_user_id: context.userId,
          target_course_ids: courseIds ?? undefined,
          match_count: matchCount,
        });
        if (error) throw error;
        
        semanticMatches = (rows ?? []).map((row: any) => ({
          chunk_id: row.chunk_id,
          document_id: row.document_id,
          google_course_id: row.google_course_id,
          chunk_index: row.chunk_index,
          content: row.content,
          similarity: Number(row.similarity || 0),
          document_title: row.document_title || "Document",
          alternate_link: row.alternate_link || null,
          course_name: null
        }));
      } catch (sbErr) {
        console.error("[RAG Search] Supabase vector query failed:", sbErr);
      }
    }
    const t2 = performance.now();

    let finalMatches = [...semanticMatches];

    // 2. Direct Keyword & Document Title matching
    let keywordMatches: any[] = [];
    if (tokens.length > 0) {
      if (usePg) {
        const conditions: string[] = [];
        const queryParams: any[] = [context.userId];
        
        tokens.forEach((token, idx) => {
          conditions.push(`content ILIKE $${idx + 2} OR document_title ILIKE $${idx + 2}`);
          queryParams.push(`%${token}%`);
        });
        
        const keywordSql = `SELECT id AS chunk_id, document_id, course_id AS google_course_id, chunk_index, content, document_title, source_url AS alternate_link, course_name FROM classroom_chunks WHERE user_id = $1 AND (${conditions.join(" OR ")}) LIMIT 15`;
        
        try {
          const kwResult = await queryPg(keywordSql, queryParams);
          keywordMatches = kwResult.rows;
        } catch (kwErr) {
          console.warn("[RAG Search] PostgreSQL keyword query failed:", kwErr);
        }
      } else {
        // Supabase keyword match using standard columns
        try {
          let matchedDocIds: string[] = [];
          const orTitleFilters = tokens.map((t) => `title.ilike.%${t}%`).join(",");
          const { data: matchedDocs } = await context.supabase
            .from("classroom_documents")
            .select("id")
            .eq("user_id", context.userId)
            .or(orTitleFilters);
          if (matchedDocs && matchedDocs.length > 0) {
            matchedDocIds = matchedDocs.map((d: any) => d.id);
          }

          if (matchedDocIds.length > 0) {
            const { data: keywordDocChunks } = await context.supabase
              .from("classroom_chunks")
              .select(`id, document_id, google_course_id, chunk_index, content, classroom_documents!inner(title, alternate_link)`)
              .eq("user_id", context.userId)
              .in("document_id", matchedDocIds)
              .limit(15);
            if (keywordDocChunks) {
              keywordDocChunks.forEach((kc: any) => {
                keywordMatches.push({
                  chunk_id: kc.id,
                  document_id: kc.document_id,
                  google_course_id: kc.google_course_id,
                  chunk_index: kc.chunk_index,
                  content: kc.content,
                  document_title: kc.classroom_documents?.title || "",
                  alternate_link: kc.classroom_documents?.alternate_link || null
                });
              });
            }
          }

          const orContentFilters = tokens.map((t) => `content.ilike.%${t}%`).join(",");
          const { data: keywordContentChunks } = await context.supabase
            .from("classroom_chunks")
            .select(`id, document_id, google_course_id, chunk_index, content, classroom_documents!inner(title, alternate_link)`)
            .eq("user_id", context.userId)
            .or(orContentFilters)
            .limit(10);
          if (keywordContentChunks) {
            keywordContentChunks.forEach((kc: any) => {
              const alreadyExists = keywordMatches.some((m) => m.chunk_id === kc.id);
              if (!alreadyExists) {
                keywordMatches.push({
                  chunk_id: kc.id,
                  document_id: kc.document_id,
                  google_course_id: kc.google_course_id,
                  chunk_index: kc.chunk_index,
                  content: kc.content,
                  document_title: kc.classroom_documents?.title || "",
                  alternate_link: kc.classroom_documents?.alternate_link || null
                });
              }
            });
          }
        } catch (sbKwErr) {
          console.warn("[RAG Search] Supabase keyword search failed:", sbKwErr);
        }
      }
    }

    if (keywordMatches.length > 0) {
      for (const kc of keywordMatches) {
        const existing = finalMatches.find((m) => m.chunk_id === kc.chunk_id);
        if (existing) {
          existing.similarity = Math.min(1.0, existing.similarity + 0.3);
        } else {
          finalMatches.push({
            chunk_id: kc.chunk_id,
            document_id: kc.document_id,
            google_course_id: kc.google_course_id,
            chunk_index: kc.chunk_index,
            content: kc.content,
            similarity: 0.7,
            document_title: kc.document_title,
            alternate_link: kc.alternate_link,
            course_name: kc.course_name || null
          });
        }
      }
    }

    // Sort and limit
    finalMatches.sort((a, b) => b.similarity - a.similarity);
    finalMatches = finalMatches.slice(0, matchCount);

    const uniqCourseIds = Array.from(new Set(finalMatches.map((m) => m.google_course_id).filter(Boolean)));
    let courseMap = new Map<string, string>();
    if (uniqCourseIds.length) {
      const { data: courses } = await context.supabase
        .from("classroom_courses")
        .select("google_course_id, name")
        .eq("user_id", context.userId)
        .in("google_course_id", uniqCourseIds);
      courseMap = new Map((courses ?? []).map((c: any) => [c.google_course_id, c.name]));
    }

    return {
      matches: finalMatches.map((m) => ({
        chunkId: m.chunk_id,
        documentId: m.document_id,
        courseId: m.google_course_id,
        chunkIndex: m.chunk_index,
        content: m.content,
        similarity: m.similarity,
        documentTitle: m.document_title,
        alternateLink: m.alternate_link,
        courseName: m.course_name || courseMap.get(m.google_course_id) || null,
      })),
      timings: {
        embedMs: Math.round(t1 - t0),
        queryMs: Math.round(t2 - t1),
        totalMs: Math.round(t2 - t0),
      },
      requested: { matchCount, courseIds, query: q },
    };
  });
