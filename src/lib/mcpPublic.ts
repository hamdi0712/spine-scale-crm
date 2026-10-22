// What the Claude connector exposes, and to whom.
//
// The app is meant to be reached through Tailscale Funnel so claude.ai can
// call /api/mcp. Funnel publishes a port, not a path, so the line between
// "the connector" and "the CRM" is drawn here, in the app, and the
// middleware enforces it on every request:
//
//   A public request — one that came in through Funnel — reaches only the
//   connector's own routes below. Everything else answers 404, with or
//   without a session cookie, so the public URL is not a second way into
//   the CRM: not the pages, not the server actions, not /login.
//
//   A local request (localhost, the LAN) is unchanged: the connector routes
//   do their own auth (bearer token or the app password), and every other
//   page and API route still requires the normal session.
//
// Edge-safe: imported by src/middleware.ts, so no Node or Prisma here.

// Tailscale's serve proxy sets this on Funnel traffic and strips any copy a
// client sends, so it cannot be forged from the internet.
export const FUNNEL_HEADER = "tailscale-funnel-request";

export function isPublicRequest(headers: Headers): boolean {
  if (headers.get(FUNNEL_HEADER)) return true;
  // Belt and braces: anything addressed to the machine's *.ts.net name is the
  // public URL, whichever way it arrived.
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  return host.endsWith(".ts.net");
}

// The connector's routes. Each does its own authentication; none of them
// reads or sets the CRM session.
const CONNECTOR_PATHS = [
  /^\/api\/mcp\/?$/,
  /^\/api\/oauth\/(register|token|revoke|authorize)\/?$/,
  /^\/oauth\/authorize\/?$/,
  /^\/\.well-known\/oauth-authorization-server(\/.*)?$/,
  /^\/\.well-known\/oauth-protected-resource(\/.*)?$/,
];

export function isConnectorPath(pathname: string): boolean {
  return CONNECTOR_PATHS.some((re) => re.test(pathname));
}

// What the sign-in page needs to render from the public URL: the build's
// static files (CSS, fonts, the page's JS) and the logo it shows. Static,
// already public in every sense that matters, and nothing else.
//
// One route sits outside this gate: Next answers /_next/image before
// middleware runs, so the optimizer is reachable from the public URL whatever
// this says. It only ever returns images from public/ — it refuses anything
// that is not an image, and the request it makes for the source file comes
// back through this middleware like any other — so the most it can hand out
// is the app's own artwork, resized.
const PUBLIC_FILES = ["/favicon.ico", "/logo-wordmark.png", "/logo-icon.png"];

export function isPublicAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/static/") || PUBLIC_FILES.includes(pathname);
}

// The origin the connector is reached at, as the caller sees it. MCP_PUBLIC_URL
// pins it; otherwise it is read off the forwarded headers Funnel sets (and the
// plain Host header locally), so the same build answers correctly on
// http://localhost:3000 and on https://<machine>.<tailnet>.ts.net.
export function baseUrl(headers: Headers): string {
  const pinned = process.env.MCP_PUBLIC_URL?.trim();
  if (pinned) return pinned.replace(/\/+$/, "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    (host.split(":")[0].endsWith(".ts.net") ? "https" : "http");
  return `${proto}://${host}`;
}
