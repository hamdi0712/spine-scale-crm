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
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|logo-icon.png|logo-wordmark.png|iman-avatar.png).*)",
  ],
};
