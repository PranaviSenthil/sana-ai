import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/** Verify signed state and return the payload (or null). */
function verifyState(state: string): { uid: string; exp: number; origin: string } | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function errorRedirect(origin: string, reason: string): Response {
  const url = `${origin}/chat?classroom=error&reason=${encodeURIComponent(reason)}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const Route = createFileRoute("/api/public/classroom/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[Google OAuth] Callback received");
        const url = new URL(request.url);
        const origin = url.origin;
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          console.error(`[Google OAuth] Callback returned OAuth error: ${oauthError}`);
          return errorRedirect(origin, oauthError);
        }
        if (!code || !state) {
          console.error("[Google OAuth] Callback missing code or state parameters");
          return errorRedirect(origin, "missing_params");
        }

        const payload = verifyState(state);
        if (!payload) {
          console.error("[Google OAuth] State verification failed or state expired");
          return errorRedirect(origin, "invalid_state");
        }

        console.log("[Google OAuth] Authorization code received: YES");

        const clientId = process.env.GOOGLE_CLASSROOM_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          console.error("[Google OAuth] Server misconfigured: Client ID or Secret missing");
          return errorRedirect(origin, "server_misconfigured");
        }

        // Exchange code for tokens.
        const redirectUri = `${payload.origin || origin}/api/public/classroom/callback`;
        console.log("[Google OAuth] Token exchange started");
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) {
          const text = await tokenRes.text();
          console.error("[classroom callback] token exchange failed", tokenRes.status, text);
          let errDesc = "token_exchange_failed";
          try {
            const errObj = JSON.parse(text);
            errDesc = errObj.error_description || errObj.error || "token_exchange_failed";
          } catch {}
          return errorRedirect(origin, errDesc);
        }
        const tokens = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          id_token?: string;
        };

        console.log("[Google OAuth] Token exchange successful");
        console.log("[Google OAuth] Refresh token received in response:", tokens.refresh_token ? "YES" : "NO");

        // Fetch user profile.
        let email: string | null = null;
        let name: string | null = null;
        let picture: string | null = null;
        let sub: string | null = null;
        try {
          const uRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          if (uRes.ok) {
            const u = (await uRes.json()) as { sub?: string; email?: string; name?: string; picture?: string };
            sub = u.sub ?? null;
            email = u.email ?? null;
            name = u.name ?? null;
            picture = u.picture ?? null;
          }
        } catch (e) {
          console.warn("[classroom callback] userinfo failed", e);
        }

        // Persist connection (upsert). Uses service-role client to bypass RLS in this
        // public route; user is authenticated by our signed state.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Retrieve existing connection to preserve refresh token if Google does not supply one on re-auth
        const { data: existingConn } = await supabaseAdmin
          .from("classroom_connections")
          .select("refresh_token")
          .eq("user_id", payload.uid)
          .maybeSingle();

        const expiresAt = tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null;

        const refreshToken = tokens.refresh_token || existingConn?.refresh_token || null;

        const { error } = await supabaseAdmin.from("classroom_connections").upsert(
          {
            user_id: payload.uid,
            google_sub: sub,
            google_email: email,
            google_name: name,
            google_picture: picture,
            access_token: tokens.access_token,
            refresh_token: refreshToken,
            token_expires_at: expiresAt,
            scope: tokens.scope ?? null,
            status: "connected",
            last_error: null,
          },
          { onConflict: "user_id" },
        );
        if (error) {
          console.error("[classroom callback] upsert failed", error);
          return errorRedirect(origin, "save_failed");
        }

        console.log("[Google OAuth] Connection persisted, refresh token stored securely");
        console.log("[Google OAuth] Google connection successfully initialized");

        return new Response(null, {
          status: 302,
          headers: { Location: `${origin}/chat?classroom=connected` },
        });
      },
    },
  },
});
