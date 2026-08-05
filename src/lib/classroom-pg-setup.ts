import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read DATABASE_URL directly from the .env file
function getConnectionString(): string | undefined {
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*DATABASE_URL\s*=\s*["']?(.*?)["']?\s*$/);
        if (match) return match[1].trim();
      }
    }
  } catch (e) {
    console.warn("[DB Setup] Failed to read .env file directly:", e);
  }
  return process.env.DATABASE_URL;
}

async function setup() {
  const connectionString = getConnectionString();
  
  if (!connectionString) {
    console.error("[DB Setup] ERROR: DATABASE_URL is not defined in the .env file.");
    process.exit(1);
  }

  console.log("[DB Setup] Connecting to local PostgreSQL using connection string...");
  const pool = new pg.Pool({ connectionString });

  try {
    const client = await pool.connect();
    console.log("[DB Setup] Connected successfully! Enabling vector extension...");
    
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    console.log("[DB Setup] vector extension enabled.");

    // Locate postgres_schema.sql
    const schemaPath = path.join(process.cwd(), "postgres_schema.sql");
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`postgres_schema.sql file not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    console.log("[DB Setup] Creating classroom_chunks table and indexes...");
    
    await client.query(schemaSql);
    console.log("[DB Setup] Database setup completed successfully! 🎉");
    
    client.release();
  } catch (err) {
    console.error("[DB Setup] Database setup FAILED:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setup();
