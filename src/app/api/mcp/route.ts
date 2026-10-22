// The Claude connector: a remote MCP server over Streamable HTTP.
//
// Stateless — a fresh server and transport per request, JSON responses rather
// than SSE streams — because every tool is a single read that answers at once
// and there is nothing to keep between calls. Every request must carry a
// valid OAuth access token; one that does not gets a 401 pointing at the
// protected-resource metadata, which is how claude.ai discovers where to sign
// in. See src/lib/mcpServer.ts for the tools and src/lib/mcpOAuth.ts for the
// tokens.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcpServer";
import { verifyAccessToken } from "@/lib/mcpOAuth";
import { CORS_HEADERS, json, preflight, resourceMetadataUrl } from "@/lib/mcpHttp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request): Promise<Response> {
  const token = await verifyAccessToken(req.headers.get("authorization"));
  if (!token) {
    const hadToken = !!req.headers.get("authorization");
    return json(
      {
        error: hadToken ? "invalid_token" : "unauthorized",
        error_description: hadToken
          ? "The access token is invalid, expired or revoked."
          : "This MCP server requires an OAuth access token.",
      },
      401,
      {
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(req.headers)}"${
          hadToken ? ', error="invalid_token"' : ""
        }`,
      },
    );
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req, {
      authInfo: {
        token: token.tokenId,
        clientId: token.clientId,
        scopes: token.scope.split(" "),
        expiresAt: token.expiresAt,
      },
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    const body = await res.text();
    return new Response(body || null, { status: res.status, headers });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
