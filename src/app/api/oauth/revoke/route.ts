// RFC 7009 token revocation, for a client disconnecting itself. The operator's
// own off-switch is Settings → Connectors.

import { revokeToken } from "@/lib/mcpOAuth";
import { oauthError, preflight, readForm, CORS_HEADERS } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ok = await revokeToken(await readForm(req), req.headers.get("authorization"));
  if (!ok) return oauthError("invalid_client", "Unknown client or bad client credentials.", 401);
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export const OPTIONS = preflight;
