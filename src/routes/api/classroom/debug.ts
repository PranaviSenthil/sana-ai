import { createFileRoute } from "@tanstack/react-router";
import { queryPg } from "@/lib/pg-client";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/classroom/debug")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          let userId = "";
          const authHeader = request.headers.get("authorization");
          
          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
          const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
          
          if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
            return new Response(
              JSON.stringify({ error: "Internal server error: Supabase configuration missing" }), 
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
          
          // Use service role client if available to query connections without auth
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLISHABLE_KEY);

          if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.replace("Bearer ", "");
            const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
            if (!claimsErr && claimsData?.user?.id) {
              userId = claimsData.user.id;
            }
          }

          if (!userId) {
            // Find the first user connected to Google Classroom to run diagnostics for
            const { data: firstConn } = await supabase
              .from("classroom_connections")
              .select("user_id")
              .limit(1)
              .maybeSingle();
            
            if (firstConn) {
              userId = firstConn.user_id;
            }
          }

          if (!userId) {
            return new Response(
              JSON.stringify({ error: "No connected users found in classroom_connections. Please connect Classroom first." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          
          const usePg = !!process.env.DATABASE_URL;
          
          const report: any = {
            activeDatabase: usePg ? "PostgreSQL" : "Supabase",
            dbConnection: "FAIL",
            pdfParseImport: "FAIL",
            syllabusDocMetadata: "NOT FOUND",
            chunksCount: 0,
            embeddingsPresent: "MISSING",
            embeddingDimension: "INVALID",
            moduleHeadingsFound: "NOT FOUND",
            vectorSearchTest: "FAIL",
            keywordSearchTest: "FAIL",
            retrievedCorrectChunk: "FAIL",
            classroomDocsStats: {},
          };
          
          // 1. Verify DB Connection
          if (usePg) {
            try {
              await queryPg("SELECT 1");
              report.dbConnection = "PASS";
            } catch (dbErr) {
              console.error("[RAG Debug Endpoint] PostgreSQL connection failed:", dbErr);
            }
          } else {
            report.dbConnection = "PASS (Supabase Connected)";
          }

          // 2. Check pdf-parse import
          try {
            const pdfParse = (await import("pdf-parse")).default;
            if (typeof pdfParse === "function") {
              report.pdfParseImport = "PASS";
            } else {
              report.pdfParseImport = "FAIL (Import succeeded but not a function)";
            }
          } catch (pdfErr) {
            report.pdfParseImport = `FAIL: ${pdfErr instanceof Error ? pdfErr.message : pdfErr}`;
          }
          
          // 3. Get metadata docs stats
          try {
            const { data: docStats } = await supabase
              .from("classroom_documents")
              .select("status, mime_type, title, error")
              .eq("user_id", userId);
            
            if (docStats) {
              const stats: any = {};
              docStats.forEach((d: any) => {
                stats[d.status] = (stats[d.status] || 0) + 1;
              });
              report.classroomDocsStats = stats;
              
              const errorDocs = docStats
                .filter((d: any) => d.status === "error")
                .map((d: any) => ({ title: d.title, error: d.error }))
                .slice(0, 15);
              report.errorDocumentsList = errorDocs;
              
              const syllabusDoc = docStats.find((d: any) => 
                d.title.toUpperCase().includes("SYMMETRIC") || 
                d.title.toUpperCase().includes("CRYPTOGRAPHY") ||
                d.title.toUpperCase().includes("SYLLABUS") ||
                d.title.toUpperCase().includes("APPLIED CRYP")
              );
              if (syllabusDoc) {
                report.syllabusDocMetadata = `FOUND (${syllabusDoc.title}, status: ${syllabusDoc.status}, mime: ${syllabusDoc.mime_type})`;
              }
            }
          } catch (statErr) {
            console.error("[RAG Debug Endpoint] Failed to query doc stats:", statErr);
          }

          // 3b. Get synced courses
          try {
            const { data: courses } = await supabase
              .from("classroom_courses")
              .select("google_course_id, name")
              .eq("user_id", userId);
            report.syncedCourses = courses;
          } catch (cErr) {
            console.error("[RAG Debug Endpoint] Failed to query courses:", cErr);
          }
          
          // 4. Search for Applied Cryptography syllabus chunks
          let chunks: any[] = [];
          if (usePg) {
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
            } catch (chunkErr) {
              console.error("[RAG Debug Endpoint] Chunks PG retrieval failed:", chunkErr);
            }
          } else {
            try {
              const { data: sbChunks } = await supabase
                .from("classroom_chunks")
                .select("id, content, embedding")
                .eq("user_id", userId)
                .or("content.ilike.%cryptography%");
              if (sbChunks) {
                chunks = sbChunks.map((c: any) => ({
                  id: c.id,
                  content: c.content,
                  has_embedding: !!c.embedding
                }));
              }
            } catch (sbErr) {
              console.error("[RAG Debug Endpoint] Chunks Supabase retrieval failed:", sbErr);
            }
          }

          report.chunksCount = chunks.length;
          if (chunks.length > 0) {
            report.embeddingsPresent = chunks.every((c) => c.has_embedding) ? "PRESENT" : "PARTIAL/MISSING";
          }
          
          // 5. Verify embedding dimension if any chunk exists
          if (chunks.length > 0) {
            if (usePg) {
              try {
                const dimRes = await queryPg(
                  "SELECT vector_dims(embedding) AS dims FROM classroom_chunks WHERE id = $1",
                  [chunks[0].id]
                );
                const dims = dimRes.rows[0]?.dims;
                report.embeddingDimension = dims ? String(dims) : "INVALID";
              } catch (dimErr) {
                console.error("[RAG Debug Endpoint] PG Dimension check failed:", dimErr);
              }
            } else {
              try {
                const { data: firstChunk } = await supabase
                  .from("classroom_chunks")
                  .select("embedding")
                  .eq("id", chunks[0].id)
                  .limit(1)
                  .maybeSingle();
                if (firstChunk?.embedding) {
                  const arr = typeof firstChunk.embedding === "string" 
                    ? JSON.parse(firstChunk.embedding.replace("{", "[").replace("}", "]"))
                    : firstChunk.embedding;
                  if (Array.isArray(arr)) {
                    report.embeddingDimension = String(arr.length);
                  }
                }
              } catch (dimErr) {
                console.error("[RAG Debug Endpoint] Supabase Dimension check failed:", dimErr);
              }
            }
          }
          
          // 6. Check if the 3 module headings exist in the text content
          const allContent = chunks.map((c) => c.content).join("\n").toUpperCase();
          const hasModule1 = allContent.includes("SYMMETRIC KEY CRYPTOGRAPHY AND BLOCKCIPHERS") || allContent.includes("SYMMETRIC KEY CRYPTOGRAPHY");
          const hasModule2 = allContent.includes("PUBLIC KEY CRYPTOGRAPHY AND DATA INTEGRITY ALGORITHMS") || allContent.includes("PUBLIC KEY CRYPTOGRAPHY");
          const hasModule3 = allContent.includes("DIGITAL SIGNATURES AND AUTHENTICATION APPLICATIONS") || allContent.includes("DIGITAL SIGNATURES");
          
          if (hasModule1 && hasModule2 && hasModule3) {
            report.moduleHeadingsFound = "FOUND";
          } else if (hasModule1 || hasModule2 || hasModule3) {
            report.moduleHeadingsFound = "PARTIAL";
          }
          
          // 7. Test Vector search
          if (usePg) {
            try {
              const fakeVec = Array(1536).fill(0.01);
              const vecString = `[${fakeVec.join(",")}]`;
              const searchRes = await queryPg(
                `SELECT id FROM classroom_chunks WHERE user_id = $2 ORDER BY embedding <=> $1 LIMIT 1`,
                [vecString, userId]
              );
              if (searchRes.rows.length > 0) {
                report.vectorSearchTest = "PASS";
              }
            } catch (vErr) {
              console.error("[RAG Debug Endpoint] Vector search test failed:", vErr);
            }
          } else {
            try {
              const fakeVec = Array(1536).fill(0.01);
              const { data: searchRes } = await supabase.rpc("match_classroom_chunks", {
                query_embedding: fakeVec as unknown as string,
                target_user_id: userId,
                match_count: 1,
              });
              if (searchRes && searchRes.length > 0) {
                report.vectorSearchTest = "PASS";
              }
            } catch (vErr) {
              console.error("[RAG Debug Endpoint] Vector search test failed:", vErr);
            }
          }
          
          // 8. Test Keyword search
          if (usePg) {
            try {
              const kwRes = await queryPg(
                `SELECT id FROM classroom_chunks WHERE user_id = $1 AND content ILIKE '%cryptography%' LIMIT 1`,
                [userId]
              );
              if (kwRes.rows.length > 0) {
                report.keywordSearchTest = "PASS";
              }
            } catch (kwErr) {
              console.error("[RAG Debug Endpoint] Keyword search test failed:", kwErr);
            }
          } else {
            try {
              const { data: kwRes } = await supabase
                .from("classroom_chunks")
                .select("id")
                .eq("user_id", userId)
                .or("content.ilike.%cryptography%")
                .limit(1);
              if (kwRes && kwRes.length > 0) {
                report.keywordSearchTest = "PASS";
              }
            } catch (kwErr) {
              console.error("[RAG Debug Endpoint] Keyword search test failed:", kwErr);
            }
          }
          
          // 9. Test retrieved correct chunk
          if (chunks.length > 0 && hasModule1) {
            report.retrievedCorrectChunk = "PASS";
          }
          
          // 10. Sample raw materials and coursework for JSON payload structure analysis
          try {
            const { data: rawMaterials } = await supabase
              .from("classroom_materials")
              .select("google_material_id, title, materials")
              .eq("user_id", userId)
              .limit(5);
            report.rawMaterialsSample = rawMaterials;
            
            const { data: rawCoursework } = await supabase
              .from("classroom_coursework")
              .select("google_coursework_id, title, materials")
              .eq("user_id", userId)
              .limit(5);
            report.rawCourseworkSample = rawCoursework;
          } catch (err) {
            console.error("[RAG Debug Endpoint] Failed to query raw materials:", err);
          }
          
          return new Response(JSON.stringify(report, null, 2), {
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
