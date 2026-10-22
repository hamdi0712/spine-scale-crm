// RFC 9728 protected-resource metadata for /api/mcp: which authorization
// server issues its tokens. Served at the bare well-known path and at the
// path-suffixed one (/.well-known/oauth-protected-resource/api/mcp) that the
// 401 points to, since clients try both.

import { baseUrl } from "@/lib/mcpPublic";
import { MCP_RESOURCE_PATH, MCP_SCOPE } from "@/lib/mcpOAuth";
import { json, preflight } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const base = baseUrl(req.headers);
  return json({
    resource: `${base}${MCP_RESOURCE_PATH}`,
    authorization_servers: [base],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Spine Scale CRM",
  });
}

export const OPTIONS = preflight;
