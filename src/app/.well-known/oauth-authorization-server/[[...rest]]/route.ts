// RFC 8414 authorization-server metadata. The issuer is the app's own origin,
// so the document is served at the bare path; the catch-all also answers the
// path-suffixed form some clients try first.

import { baseUrl } from "@/lib/mcpPublic";
import { MCP_SCOPE } from "@/lib/mcpOAuth";
import { json, preflight } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const base = baseUrl(req.headers);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  });
}

export const OPTIONS = preflight;
