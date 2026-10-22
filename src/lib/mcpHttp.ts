// Response helpers shared by the connector's route handlers.
//
// CORS is open on these routes and only these: they authenticate with a
// bearer token or a form post, never a cookie, so a browser-based client (the
// MCP Inspector, for one) can call them from its own origin without that
// opening anything a page in another tab could ride on.

import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/mcpPublic";
import { MCP_RESOURCE_PATH } from "@/lib/mcpOAuth";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}

export function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function resourceMetadataUrl(headers: Headers): string {
  return `${baseUrl(headers)}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}

// Token endpoints take form bodies; a client that sends JSON instead is
// accommodated rather than refused.
export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") form.set(k, v);
    return form;
  }
  return new URLSearchParams(await req.text());
}
