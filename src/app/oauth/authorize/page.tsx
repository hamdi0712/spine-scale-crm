import { LogoWordmarkChip } from "@/components/Logo";
import { checkAuthorizeRequest, redirectWith } from "@/lib/mcpOAuth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The authorize step of the Claude connector's OAuth flow: the app's own
// sign-in card, with one line above the password saying who is asking and
// what they get. Typing the app password here is the consent.
//
// A plain HTML form posting to /api/oauth/authorize — no client JavaScript and
// no server action — so it works from the public URL with nothing else of the
// app exposed there, and the password check lives in a route that can be
// throttled.

const ERRORS: Record<string, string> = {
  password: "Incorrect password.",
  locked: "Too many incorrect passwords. Sign-in is paused for 15 minutes.",
  unset: "APP_PASSWORD is not set. Add it to the .env file and restart the server.",
};

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

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const check = await checkAuthorizeRequest((k) => first(searchParams[k]));

  if (!check.ok && check.redirect) {
    redirect(
      redirectWith(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
      }),
    );
  }

  const error = first(searchParams.error);
  const returnTo = check.ok ? new URL(check.params.redirectUri).host : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8">
          <LogoWordmarkChip />
          <div className="mt-3 text-sm text-muted">Internal Ops CRM</div>
        </div>
        {!check.ok ? (
          <p className="rounded-[10px] bg-bad-soft px-3.5 py-2.5 text-sm text-bad">{check.message}</p>
        ) : (
          <form method="post" action="/api/oauth/authorize" className="space-y-5">
            <p className="text-sm leading-relaxed">
              <span className="font-medium">{check.params.clientName}</span> wants read-only access to
              your pipeline, outreach, clients, tasks and daily numbers. It cannot change anything.
              Sign in to allow it; you will be sent back to <span className="font-medium">{returnTo}</span>.
            </p>
            {PASSED_THROUGH.map((key) => {
              const v = first(searchParams[key]);
              return v === null ? null : <input key={key} type="hidden" name={key} value={v} />;
            })}
            <div>
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <input id="password" name="password" type="password" autoFocus required className="field" />
            </div>
            {error && ERRORS[error] && (
              <p className="rounded-[10px] bg-bad-soft px-3.5 py-2.5 text-sm text-bad">{ERRORS[error]}</p>
            )}
            <button type="submit" name="decision" value="allow" className="btn-primary w-full justify-center">
              Sign in and allow
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              formNoValidate
              className="btn-ghost w-full justify-center"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
