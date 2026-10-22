// The token endpoint: authorization code (with PKCE) and refresh token grants.

import { exchangeToken } from "@/lib/mcpOAuth";
import { json, oauthError, preflight, readForm } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const result = await exchangeToken(await readForm(req), req.headers.get("authorization"));
  if (!result.ok) return oauthError(result.error, result.description, result.status);
  return json(result.body);
}

export const OPTIONS = preflight;
