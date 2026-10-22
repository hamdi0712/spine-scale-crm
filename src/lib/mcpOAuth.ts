// OAuth 2.1 for the Claude connector: dynamic client registration, the
// authorization code flow with PKCE (S256 only), refresh-token rotation, and
// the bearer check every /api/mcp request goes through.
//
// There is one user and one credential, APP_PASSWORD, so there is no consent
// database and no per-user anything: a grant is "whoever typed the app
// password on the sign-in page let this client read the CRM". The password is
// asked for on every authorization, even with a browser session already open,
// because registration is open to anyone who can reach the public URL — a
// silent consent would let any registered client collect a code from a link.
//
// Codes, tokens and client secrets are random 256-bit values, handed out once
// and stored only as SHA-256 hashes.
//
// Server-only: this imports Prisma and node:crypto.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { expectedSessionToken } from "@/lib/auth";

export const MCP_SCOPE = "crm.read";
export const MCP_RESOURCE_PATH = "/api/mcp";

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Registration is unauthenticated by design (claude.ai registers itself), so
// it is held to a ceiling: clients that never completed a sign-in are swept
// after a day, and at most this many may exist at once.
const MAX_CLIENTS = 50;
const STALE_CLIENT_MS = 24 * 60 * 60 * 1000;

// ─── Small pieces ──────────────────────────────────────────────────────────

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secret(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: unknown): boolean {
  const password = process.env.APP_PASSWORD;
  if (!password || typeof candidate !== "string") return false;
  return safeEqual(sha256(candidate), sha256(password));
}

async function passwordTag(): Promise<string | null> {
  const token = await expectedSessionToken();
  return token ? sha256(`mcp:${token}`) : null;
}

// ─── Sign-in throttle ──────────────────────────────────────────────────────
//
// The sign-in page is on the public internet, so the password is guessable
// there in a way it is not on localhost. One user means one counter: after
// MAX_FAILURES wrong passwords inside the window, the page refuses everything
// until the window has passed. In memory, so a restart clears it — which
// needs access to the machine, and is the point.

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
let failures: number[] = [];

export function signInLocked(): boolean {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  failures = failures.filter((t) => t > cutoff);
  return failures.length >= MAX_FAILURES;
}

export function recordSignInFailure(): void {
  failures.push(Date.now());
}

// Registration gets the same treatment, looser.
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const MAX_REGISTRATIONS = 20;
let registrations: number[] = [];

export function registrationLimited(): boolean {
  const cutoff = Date.now() - REGISTER_WINDOW_MS;
  registrations = registrations.filter((t) => t > cutoff);
  if (registrations.length >= MAX_REGISTRATIONS) return true;
  registrations.push(Date.now());
  return false;
}

// ─── Redirect URIs ─────────────────────────────────────────────────────────
//
// Where a code may be sent. claude.ai's callback, loopback (Claude Desktop,
// Claude Code and the MCP Inspector all listen on localhost), and anything
// added to MCP_OAUTH_REDIRECT_ORIGINS. Checked at registration and again,
// exactly, at authorization.

const ALLOWED_REDIRECT_ORIGINS = ["https://claude.ai", "https://claude.com"];

export function redirectUriAllowed(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
  }
  const extra = (process.env.MCP_OAUTH_REDIRECT_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...ALLOWED_REDIRECT_ORIGINS, ...extra].includes(url.origin);
}

// ─── Clients ───────────────────────────────────────────────────────────────

export type RegisteredClient = {
  clientId: string;
  clientSecret?: string;
  name: string;
  redirectUris: string[];
  authMethod: string;
  createdAt: Date;
};

export type RegisterResult =
  | { ok: true; client: RegisteredClient }
  | { ok: false; error: string; description: string };

export async function registerClient(meta: Record<string, unknown>): Promise<RegisterResult> {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.some((u) => typeof u !== "string")) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be a non-empty array of strings." };
  }
  const bad = (uris as string[]).find((u) => !redirectUriAllowed(u));
  if (bad) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: `Redirect URI not allowed: ${bad}. Allowed are claude.ai, claude.com, loopback, and the origins in MCP_OAUTH_REDIRECT_ORIGINS.`,
    };
  }
  const requested = typeof meta.token_endpoint_auth_method === "string" ? meta.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(requested)) {
    return { ok: false, error: "invalid_client_metadata", description: `Unsupported token_endpoint_auth_method: ${requested}.` };
  }
  const grantTypes = Array.isArray(meta.grant_types) ? meta.grant_types : ["authorization_code"];
  if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return { ok: false, error: "invalid_client_metadata", description: "Only authorization_code and refresh_token grants are supported." };
  }

  // Sweep clients that registered and never finished signing in.
  await prisma.mcpOAuthClient.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - STALE_CLIENT_MS) }, tokens: { none: {} } },
  });
  if ((await prisma.mcpOAuthClient.count()) >= MAX_CLIENTS) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Too many registered clients. Revoke connector access in Settings → Connectors and try again.",
    };
  }

  const name =
    typeof meta.client_name === "string" && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, 100)
      : "Unnamed client";
  const clientSecret = requested === "none" ? undefined : secret();
  const row = await prisma.mcpOAuthClient.create({
    data: {
      id: `mcp_${randomBytes(16).toString("hex")}`,
      name,
      redirectUris: JSON.stringify(uris),
      authMethod: requested,
      secretHash: clientSecret ? sha256(clientSecret) : null,
    },
  });
  return {
    ok: true,
    client: {
      clientId: row.id,
      clientSecret,
      name,
      redirectUris: uris as string[],
      authMethod: requested,
      createdAt: row.createdAt,
    },
  };
}

export async function findClient(clientId: string) {
  const row = await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } });
  if (!row) return null;
  let redirectUris: string[] = [];
  try {
    redirectUris = JSON.parse(row.redirectUris);
  } catch {
    // A row this file wrote always parses; one that does not has no URIs.
  }
  return { ...row, redirectUris };
}

// ─── Authorization request ─────────────────────────────────────────────────

export type AuthorizeParams = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
};

// Two kinds of failure, and the difference matters: until the client and its
// redirect URI are known good, an error must be shown on the page and never
// redirected (that would be an open redirect). After that, errors go back to
// the client the way OAuth says they should.
export type AuthorizeCheck =
  | { ok: true; params: AuthorizeParams }
  | { ok: false; redirect: false; message: string }
  | { ok: false; redirect: true; redirectUri: string; state: string | null; error: string; description: string };

export async function checkAuthorizeRequest(get: (key: string) => string | null): Promise<AuthorizeCheck> {
  const clientId = get("client_id");
  if (!clientId) return { ok: false, redirect: false, message: "The request has no client_id." };
  const client = await findClient(clientId);
  if (!client) {
    return {
      ok: false,
      redirect: false,
      message: "This client is not registered — access may have been revoked. Start the connection again from Claude.",
    };
  }
  const redirectUri = get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !redirectUriAllowed(redirectUri)) {
    return { ok: false, redirect: false, message: "The redirect URI does not match the one this client registered." };
  }
  const state = get("state");
  const fail = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    redirect: true,
    redirectUri,
    state,
    error,
    description,
  });
  if (get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = get("code_challenge");
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return fail("invalid_request", "A PKCE code_challenge is required.");
  }
  if ((get("code_challenge_method") ?? "plain") !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }
  const resource = get("resource");
  if (resource && !resourceMatches(resource)) {
    return fail("invalid_target", `This server only grants access to ${MCP_RESOURCE_PATH}.`);
  }
  return {
    ok: true,
    params: {
      clientId,
      clientName: client.name,
      redirectUri,
      state,
      codeChallenge,
      // Read-only is the only access there is, whatever was asked for.
      scope: MCP_SCOPE,
      resource,
    },
  };
}

// There is one protected resource. Its origin is whatever the caller reached
// it by (localhost, the ts.net name), so only the path is compared.
function resourceMatches(resource: string): boolean {
  try {
    return new URL(resource).pathname.replace(/\/+$/, "") === MCP_RESOURCE_PATH;
  } catch {
    return false;
  }
}

export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  return url.toString();
}

export async function issueCode(params: AuthorizeParams): Promise<string> {
  const code = secret();
  await prisma.mcpOAuthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.mcpOAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scope,
      resource: params.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

// ─── Token endpoint ────────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: number; error: string; description: string };

function tokenError(error: string, description: string, status = 400): TokenResult {
  return { ok: false, status, error, description };
}

// Client authentication at the token endpoint: nothing for a public client
// (PKCE is its proof), the secret for a confidential one, in the body or as
// HTTP Basic, whichever it registered for.
async function authenticateClient(form: URLSearchParams, authorization: string | null) {
  let clientId = form.get("client_id");
  let clientSecret = form.get("client_secret");
  if (authorization?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) {
      clientId = decodeURIComponent(decoded.slice(0, i));
      clientSecret = decodeURIComponent(decoded.slice(i + 1));
    }
  }
  if (!clientId) return null;
  const client = await findClient(clientId);
  if (!client) return null;
  if (client.secretHash) {
    if (!clientSecret || !safeEqual(sha256(clientSecret), client.secretHash)) return null;
  }
  return client;
}

async function mintTokens(args: {
  clientId: string;
  scope: string;
  resource: string | null;
  tag: string;
  replacing?: string;
}): Promise<TokenResponse> {
  const access = secret();
  const refresh = secret();
  const now = Date.now();
  const data = {
    clientId: args.clientId,
    accessHash: sha256(access),
    refreshHash: sha256(refresh),
    scope: args.scope,
    resource: args.resource,
    passwordTag: args.tag,
    accessExpiresAt: new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
  };
  if (args.replacing) {
    await prisma.mcpOAuthToken.update({ where: { id: args.replacing }, data });
  } else {
    await prisma.mcpOAuthToken.create({ data });
  }
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: args.scope,
  };
}

export async function exchangeToken(form: URLSearchParams, authorization: string | null): Promise<TokenResult> {
  const client = await authenticateClient(form, authorization);
  if (!client) return tokenError("invalid_client", "Unknown client or bad client credentials.", 401);
  const tag = await passwordTag();
  if (!tag) return tokenError("server_error", "APP_PASSWORD is not set on the server.", 500);

  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    if (!code || !verifier) return tokenError("invalid_request", "code and code_verifier are required.");
    const codeHash = sha256(code);
    const row = await prisma.mcpOAuthCode.findUnique({ where: { codeHash } });
    // One use, whatever happens next: a code is deleted the moment it is read.
    if (row) await prisma.mcpOAuthCode.delete({ where: { codeHash } }).catch(() => {});
    if (!row || row.clientId !== client.id || row.expiresAt < new Date()) {
      return tokenError("invalid_grant", "The authorization code is invalid or has expired.");
    }
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== row.redirectUri) {
      return tokenError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!safeEqual(challenge, row.codeChallenge)) {
      return tokenError("invalid_grant", "PKCE verification failed.");
    }
    return {
      ok: true,
      body: await mintTokens({ clientId: client.id, scope: row.scope, resource: row.resource, tag }),
    };
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token");
    if (!refresh) return tokenError("invalid_request", "refresh_token is required.");
    const row = await prisma.mcpOAuthToken.findUnique({ where: { refreshHash: sha256(refresh) } });
    if (!row || row.clientId !== client.id || row.refreshExpiresAt < new Date() || row.passwordTag !== tag) {
      if (row && row.clientId === client.id) await prisma.mcpOAuthToken.delete({ where: { id: row.id } }).catch(() => {});
      return tokenError("invalid_grant", "The refresh token is invalid, expired or revoked.");
    }
    return {
      ok: true,
      body: await mintTokens({ clientId: client.id, scope: row.scope, resource: row.resource, tag, replacing: row.id }),
    };
  }

  return tokenError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
}

// RFC 7009. Either token of a grant revokes the whole grant. Always succeeds
// from the caller's point of view, as the RFC requires.
export async function revokeToken(form: URLSearchParams, authorization: string | null): Promise<boolean> {
  const client = await authenticateClient(form, authorization);
  if (!client) return false;
  const token = form.get("token");
  if (token) {
    const hash = sha256(token);
    await prisma.mcpOAuthToken.deleteMany({
      where: { clientId: client.id, OR: [{ accessHash: hash }, { refreshHash: hash }] },
    });
  }
  return true;
}

// ─── The bearer check ──────────────────────────────────────────────────────

export type VerifiedToken = { tokenId: string; clientId: string; scope: string; expiresAt: number };

export async function verifyAccessToken(authorization: string | null): Promise<VerifiedToken | null> {
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const row = await prisma.mcpOAuthToken.findUnique({ where: { accessHash: sha256(token) } });
  if (!row || row.accessExpiresAt < new Date()) return null;
  if (row.passwordTag !== (await passwordTag())) return null;
  if (row.scope.split(" ").indexOf(MCP_SCOPE) === -1) return null;
  // Throttled to once a minute so a busy conversation is not a write per call.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.mcpOAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return {
    tokenId: row.id,
    clientId: row.clientId,
    scope: row.scope,
    expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000),
  };
}

// ─── Settings → Connectors ─────────────────────────────────────────────────

export async function listConnections() {
  const clients = await prisma.mcpOAuthClient.findMany({
    where: { tokens: { some: {} } },
    include: { tokens: { select: { createdAt: true, lastUsedAt: true, refreshExpiresAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    connectedAt: c.tokens.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), c.tokens[0].createdAt),
    lastUsedAt: c.tokens.reduce<Date | null>(
      (max, t) => (t.lastUsedAt && (!max || t.lastUsedAt > max) ? t.lastUsedAt : max),
      null,
    ),
    grants: c.tokens.length,
  }));
}

export async function revokeClient(clientId: string): Promise<void> {
  await prisma.mcpOAuthClient.deleteMany({ where: { id: clientId } });
}

// Every client, code and token. Claude has to go through Connect again.
export async function revokeAllConnectorAccess(): Promise<void> {
  await prisma.$transaction([
    prisma.mcpOAuthToken.deleteMany({}),
    prisma.mcpOAuthCode.deleteMany({}),
    prisma.mcpOAuthClient.deleteMany({}),
  ]);
}
