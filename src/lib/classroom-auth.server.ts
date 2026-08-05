import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type ConnectionRow = {
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  google_email?: string | null;
  google_name?: string | null;
};

export async function loadConn(supabase: any, userId: string): Promise<ConnectionRow> {
  const { data, error } = await supabase
    .from("classroom_connections")
    .select("access_token, refresh_token, token_expires_at, google_email, google_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Not connected to Google Classroom");
  return data as ConnectionRow;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const clientId = process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth environment variables missing");

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
  return res.json();
}

export async function getValidAccessToken(supabase: any, userId: string): Promise<string> {
  const conn = await loadConn(supabase, userId);
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const isExpired = !expiresAt || expiresAt - Date.now() < 60_000;

  if (!isExpired) return conn.access_token;
  if (!conn.refresh_token) {
    throw new Error("Google session expired. Please reconnect.");
  }

  const refreshed = await refreshAccessToken(conn.refresh_token);
  const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from("classroom_connections")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpires,
    })
    .eq("user_id", userId);
  return refreshed.access_token;
}

export async function testGoogleClassroomConnection(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://classroom.googleapis.com/v1/courses?pageSize=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
