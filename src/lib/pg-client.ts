import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[PG Client] DATABASE_URL is not defined in environment variables. Local PostgreSQL connection will fail.");
}

// Create a pg Pool for robust connection handling
export const pgPool = new pg.Pool({
  connectionString,
  ssl: connectionString?.includes("localhost") || connectionString?.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

export async function queryPg(text: string, params?: any[]) {
  const start = performance.now();
  const res = await pgPool.query(text, params);
  const duration = Math.round(performance.now() - start);
  console.log(`[PG Client] Executed query in ${duration}ms: ${text.slice(0, 120)}`);
  return res;
}
