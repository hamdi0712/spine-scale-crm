// The authorize step's form post. The page at /oauth/authorize shows the app's
// sign-in card; this checks the password and, if it is right, sends the
// browser back to the client with a one-use code.
//
// The request parameters arrive again as hidden fields and are validated again
// from scratch — nothing the page rendered is trusted.

import { NextResponse } from "next/server";
import {
  checkAuthorizeRequest,
  checkPassword,
  issueCode,
  recordSignInFailure,
  redirectWith,
  signInLocked,
} from "@/lib/mcpOAuth";
import { baseUrl } from "@/lib/mcpPublic";

export const dynamic = "force-dynamic";

const PASSED_THROUGH = [
  "client_id",
  "redirect_uri",
  "state",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
];

function back(req: Request, form: URLSearchParams, error: string) {
  const url = new URL(`${baseUrl(req.headers)}/oauth/authorize`);
  for (const key of PASSED_THROUGH) {
    const v = form.get(key);
    if (v !== null) url.searchParams.set(key, v);
  }
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const check = await checkAuthorizeRequest((k) => form.get(k));
  if (!check.ok) {
    if (!check.redirect) return new NextResponse(check.message, { status: 400 });
    return NextResponse.redirect(
      redirectWith(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
      }),
      303,
    );
  }
  const { params } = check;

  if (form.get("decision") === "deny") {
    return NextResponse.redirect(
      redirectWith(params.redirectUri, {
        error: "access_denied",
        error_description: "The operator cancelled the connection.",
        state: params.state,
      }),
      303,
    );
  }

  if (signInLocked()) return back(req, form, "locked");
  if (!process.env.APP_PASSWORD) return back(req, form, "unset");
  if (!checkPassword(form.get("password"))) {
    recordSignInFailure();
    return back(req, form, signInLocked() ? "locked" : "password");
  }

  const code = await issueCode(params);
  return NextResponse.redirect(redirectWith(params.redirectUri, { code, state: params.state }), 303);
}
