// RFC 7591 dynamic client registration — what claude.ai calls when Connect is
// clicked. Open by design (registering grants nothing; the app password is
// still asked for at sign-in), and held to a rate and a ceiling in
// src/lib/mcpOAuth.ts.

import { registerClient, registrationLimited } from "@/lib/mcpOAuth";
import { json, oauthError, preflight } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (registrationLimited()) {
    return oauthError("temporarily_unavailable", "Too many registrations. Try again later.", 429);
  }
  const meta = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return oauthError("invalid_client_metadata", "The body must be a JSON object.");
  }
  const result = await registerClient(meta);
  if (!result.ok) return oauthError(result.error, result.description);
  const { client } = result;
  return json(
    {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: client.authMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "crm.read",
    },
    201,
  );
}

export const OPTIONS = preflight;
