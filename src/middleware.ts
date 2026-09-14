import { NextRequest, NextResponse } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // The logo files are public assets: they render on the unauthenticated login
  // page, serve as the favicon, and are fetched by the /_next/image optimizer,
  // so they have to bypass the session redirect. Iman's avatar is here for the
  // optimizer's sake only — it is drawn on the signed-in copilot page, but the
  // optimizer fetches the source file back through this same server and would
  // otherwise be handed the login redirect instead of a PNG.
  //
  // Monk Mode's artwork is here for that same reason, as two prefixes rather
  // than seventeen filenames: monk-* is the hero background, the forest strip
  // and the corner mountain, and habit-* is the icon and the illustration for
  // each habit. Every one of them is drawn through next/image — they are
  // 1500px PNGs of up to 1.8MB and the optimizer is what turns them into
  // something a dashboard can load seven of — so every one of them is fetched
  // back through this server by a request carrying no session cookie. Without
  // the bypass the optimizer is handed the login page and every picture on the
  // feature is broken, which is a failure that looks like a bad path rather
  // than like auth.
  //
  // Nothing is exposed by this that was not already public: these are static
  // files under public/, served by URL to anyone who asks, and the bypass only
  // decides whether the request is answered or redirected.
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|logo-icon.png|logo-wordmark.png|iman-avatar.png|monk-.*\\.png|habit-.*\\.png).*)",
  ],
};
