// DeepSeek — the one model call in the app, behind one function.
//
// Server-only, on the same terms as src/lib/apify.ts: the key lives in
// DEEPSEEK_API_KEY, is read here, sent as a bearer header, and never returned
// to the browser in any form. Nothing in this file may be imported from a
// client component — its two callers are server actions (the lead scorecard's
// assist in src/lib/actions/icpAssist.ts, and the discovery queue in
// src/lib/actions/discovery.ts), and both hand back parsed suggestions and
// plain error text and nothing else.
//
// DeepSeek serves an OpenAI-compatible chat-completions API, so this is the
// same request this file has always made: same path, same bearer header, same
// messages array, same response_format. Only the host, the model and the key
// changed, plus the one parameter noted at `thinking` below that DeepSeek adds
// and OpenAI has no equivalent for.
//
// What comes back is JSON, asked for as JSON: the caller states the shape in
// its prompt and response_format pins the model to an object, so reading the
// reply is a JSON.parse rather than a scrape. Every way this can go wrong —
// no key, a rejected key, a refused request, a timeout, an answer cut off
// mid-object — comes back as { ok: false } with a sentence saying what to do
// about it. This function does not throw.

// Small, cheap, and fixed. Both the assist's cost and the shape of its answers
// are calibrated to this model, so it is stated once here rather than being a
// setting somebody can move without re-reading the prompt.
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

const API_URL = "https://api.deepseek.com/chat/completions";

// A scorecard suggestion is a paragraph and three short reasons. This is a
// ceiling against a runaway generation, not a target — an answer that needs
// more than this has stopped answering the question.
//
// The discovery queue asks a longer question (five disqualifiers, a category
// and three gaps, each with its own reason) and passes its own ceiling, which
// is why this is a default rather than the only value. Both are stated where
// the prompt is, so a prompt that grows carries its ceiling with it.
const MAX_OUTPUT_TOKENS = 700;

// Long enough for a slow completion, short enough that a hung request gives
// the page back rather than sitting on a spinner.
const TIMEOUT_MS = 60_000;

// The model's own error text is worth passing through, held to a length that
// keeps it a sentence rather than a stack trace.
const MAX_DETAIL_CHARS = 300;

export type DeepSeekResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function deepSeekJson({
  system,
  user,
  maxTokens = MAX_OUTPUT_TOKENS,
}: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<DeepSeekResult> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      error:
        "DEEPSEEK_API_KEY is not set. Add it to the .env file and restart the server.",
    };
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        // Bearer rather than a query parameter, so the credential never lands
        // in a URL where proxies and server logs would keep a copy of it.
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        // The reply is read by code, so it is pinned to an object rather than
        // hoped to be one. The prompt still states the shape — this only
        // guarantees valid JSON, not the right JSON.
        //
        // DeepSeek honours this on one condition OpenAI shares: the word
        // "json" has to appear in the prompt or the request is refused. It
        // does — the system prompt and the REPLY FORMAT block in
        // src/lib/icpAssist.ts both say it — so this is noted rather than
        // worked around. Anyone rewriting those prompts needs to keep it.
        response_format: { type: "json_object" },
        // The one parameter with no OpenAI counterpart, and it is not
        // optional here. V4 thinks by default, which breaks this call three
        // ways: the chain of thought comes back in reasoning_content and
        // leaves `content` empty or partial, the reasoning spends the token
        // ceiling below before the answer starts, and temperature stops
        // applying. Off, it is the plain completion this file has always
        // made.
        thinking: { type: "disabled" },
        // Scoring the same evidence twice should not give two answers.
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      return {
        ok: false,
        error: `DeepSeek did not answer within ${Math.round(
          TIMEOUT_MS / 1000,
        )} seconds and the request was given up on. Try again.`,
      };
    }
    return {
      ok: false,
      error:
        "Could not reach DeepSeek. Check the server's network connection and try again.",
    };
  }

  if (!response.ok) {
    return { ok: false, error: await errorMessage(response) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: "DeepSeek returned something that is not JSON. Try again.",
    };
  }

  const choice = (
    body as {
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    }
  )?.choices?.[0];

  // Cut off mid-object. Worth its own sentence: the JSON below would fail to
  // parse and read as a malformed answer, which is true but says nothing about
  // why or what to do.
  if (choice?.finish_reason === "length") {
    return {
      ok: false,
      error:
        "DeepSeek's answer ran past its length limit and was cut off. Try again — if it keeps happening, the website notes on this record are probably too long to summarise in one pass.",
    };
  }

  const content = choice?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    return {
      ok: false,
      error: "DeepSeek returned an empty answer. Try again.",
    };
  }
  return { ok: true, content };
}

// DeepSeek reports failures as { error: { message, type, code } }, the same
// envelope OpenAI uses. The message is its own text and carries no credential,
// so it is passed through under a heading that says what to do about it.
async function errorMessage(response: Response): Promise<string> {
  let detail = "";
  let code = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string; type?: string };
    };
    detail = body?.error?.message ?? "";
    code = body?.error?.code ?? body?.error?.type ?? "";
  } catch {
    // A non-JSON body tells us nothing beyond the status code.
  }
  const suffix = detail
    ? ` DeepSeek said: ${detail.slice(0, MAX_DETAIL_CHARS)}`
    : "";

  if (response.status === 401) {
    return `DeepSeek rejected the API key. Check DEEPSEEK_API_KEY in the .env file — it may be mistyped, revoked, or from another account.${suffix}`;
  }
  // Where OpenAI signalled an empty account with a 429 carrying
  // insufficient_quota, DeepSeek gives it a status of its own. Same sentence,
  // read off that status — and off the code too, on the same belt-and-braces
  // as before, since the two are reported independently.
  if (response.status === 402 || code === "insufficient_balance") {
    return `This DeepSeek account is out of credit, so the request was refused. Top it up and try again.${suffix}`;
  }
  if (response.status === 403) {
    return `This key is not allowed to use ${DEEPSEEK_MODEL}. Check the key's permissions in the DeepSeek platform console.${suffix}`;
  }
  if (response.status === 429) {
    return `DeepSeek is rate-limiting this key. Wait a moment and try again.${suffix}`;
  }
  if (response.status === 404) {
    return `DeepSeek has no model called ${DEEPSEEK_MODEL} available to this key.${suffix}`;
  }
  // 400 is a malformed body, 422 a bad parameter. Both mean the request went
  // out wrong rather than the account being at fault, and neither is something
  // the person at the scorecard can act on beyond reporting it.
  if (response.status === 400 || response.status === 422) {
    return `DeepSeek would not accept the request.${suffix}`;
  }
  if (response.status >= 500) {
    return `DeepSeek is having trouble (HTTP ${response.status}). Try again in a minute.${suffix}`;
  }
  return `The DeepSeek request failed (HTTP ${response.status}).${suffix}`;
}
