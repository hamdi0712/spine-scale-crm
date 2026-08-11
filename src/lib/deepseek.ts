// DeepSeek — every model call in the app, behind two functions.
//
// Server-only, on the same terms as src/lib/apify.ts: the key lives in
// DEEPSEEK_API_KEY, is read here, sent as a bearer header, and never returned
// to the browser in any form. Nothing in this file may be imported from a
// client component — its callers are server actions (the lead scorecard's
// assist in src/lib/actions/icpAssist.ts, the discovery queue in
// src/lib/actions/discovery.ts, the copilot in src/lib/actions/copilot.ts),
// and each hands back parsed answers and plain error text and nothing else.
//
// DeepSeek serves an OpenAI-compatible chat-completions API, so this is the
// same request this file has always made: same path, same bearer header, same
// messages array, same response_format. Only the host, the model and the key
// changed, plus the one parameter noted at `thinking` below that DeepSeek adds
// and OpenAI has no equivalent for.
//
// Two shapes of call, over one transport:
//
//   deepSeekJson — one system prompt, one user prompt, an answer that is JSON
//   because the caller asked for JSON. The caller states the shape in its
//   prompt and response_format pins the model to an object, so reading the
//   reply is a JSON.parse rather than a scrape.
//
//   deepSeekChat — a whole conversation, and a set of functions the model may
//   ask to have run. Same endpoint, same envelope; what it adds is the `tools`
//   array and the tool_calls that can come back instead of prose. This file
//   does not run anything — it reports what was asked for and hands it to the
//   caller, which owns the loop (src/lib/actions/copilot.ts).
//
// Every way either can go wrong — no key, a rejected key, a refused request, a
// timeout, an answer cut off mid-object, a tool call whose arguments are not
// even a string — comes back as { ok: false } with a sentence saying what to
// do about it. Neither function throws.

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

// The copilot's ceiling, and higher than the one above for a reason: its reply
// is prose somebody reads rather than a fixed object, and an answer that walks
// through four at-risk clients is legitimately longer than a scorecard's three
// reasons. Still a ceiling — a chat answer that runs past this has stopped
// answering and started reciting the database back.
const MAX_CHAT_TOKENS = 1400;

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
  const reply = await postChat({
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
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  if (!reply.ok) return reply;

  // Cut off mid-object. Worth its own sentence: the JSON below would fail to
  // parse and read as a malformed answer, which is true but says nothing about
  // why or what to do.
  if (reply.choice.finish_reason === "length") {
    return {
      ok: false,
      error:
        "DeepSeek's answer ran past its length limit and was cut off. Try again — if it keeps happening, the website notes on this record are probably too long to summarise in one pass.",
    };
  }

  const content = reply.choice.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    return {
      ok: false,
      error: "DeepSeek returned an empty answer. Try again.",
    };
  }
  return { ok: true, content };
}

// ─── Chat with tools ───────────────────────────────────────────────────────
//
// The multi-turn half of this file. Where deepSeekJson asks one question and
// reads one object back, this carries a whole conversation — including the
// tool results the caller has already gathered — and comes back with either
// prose or a request to run more tools.
//
// It is deliberately the same transport and nothing more. This function has no
// idea what any tool does, never runs one, and holds no loop: it reports what
// the model asked for. Deciding what may be run, running it, and deciding when
// to stop asking all live with the caller, which is what keeps the read-only
// guarantee somewhere a person can read it in one file rather than spread
// across a transport.

// A function the model may ask to have run, in OpenAI's tool schema — the
// shape DeepSeek accepts unchanged.
export interface DeepSeekTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

// One request to run one function. `arguments` is a JSON string the model
// wrote, not an object — it is passed through exactly as it arrived, because
// it is the caller's job to parse and validate it.
export interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// The messages a conversation is made of. Assistant turns can carry tool_calls
// instead of (or alongside) content; a tool turn is the result of one of them
// and must quote the id it answers.
export type DeepSeekChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: DeepSeekToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type DeepSeekChatResult =
  | {
      ok: true;
      // Exactly one of these two is meaningful per reply, and which one is how
      // the caller knows whether the conversation is finished: tool calls mean
      // keep going, content means this is the answer.
      content: string | null;
      toolCalls: DeepSeekToolCall[];
    }
  | { ok: false; error: string };

export async function deepSeekChat({
  messages,
  tools,
  maxTokens = MAX_CHAT_TOKENS,
}: {
  messages: DeepSeekChatMessage[];
  tools?: DeepSeekTool[];
  maxTokens?: number;
}): Promise<DeepSeekChatResult> {
  const reply = await postChat({
    max_tokens: maxTokens,
    messages,
    ...(tools && tools.length > 0
      ? // "auto" is the default, and it is the one that belongs here: the
        // model decides which lookups a question needs, including none at all
        // for a question about how the app works.
        { tools, tool_choice: "auto" }
      : {}),
  });
  if (!reply.ok) return reply;

  const { message, finish_reason } = reply.choice;
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  // Cut off. A truncated answer is a half sentence and a truncated tool call
  // is a half-written JSON argument, so neither is worth handing on.
  if (finish_reason === "length") {
    return {
      ok: false,
      error:
        "DeepSeek's answer ran past its length limit and was cut off. Ask a narrower question — one client or one tier at a time is usually enough to fix it.",
    };
  }

  // Every call is checked here rather than at the point of use, so a
  // malformed one is a sentence about the model's reply and not a crash three
  // frames deeper in whichever lookup it half-named.
  const toolCalls: DeepSeekToolCall[] = [];
  for (const call of rawCalls) {
    const c = call as Partial<DeepSeekToolCall>;
    if (
      typeof c?.id !== "string" ||
      typeof c?.function?.name !== "string" ||
      typeof c?.function?.arguments !== "string"
    ) {
      return {
        ok: false,
        error:
          "DeepSeek asked to look something up, but not in a shape that names a lookup. Nothing was run — try asking again.",
      };
    }
    toolCalls.push({
      id: c.id,
      type: "function",
      function: { name: c.function.name, arguments: c.function.arguments },
    });
  }

  const content = typeof message?.content === "string" ? message.content : null;

  // Neither prose nor a lookup. Nothing to show and nothing to run, so it is
  // reported rather than turned into an empty bubble.
  if (toolCalls.length === 0 && (content === null || content.trim() === "")) {
    return {
      ok: false,
      error: "DeepSeek returned an empty answer. Try again.",
    };
  }

  return { ok: true, content, toolCalls };
}

// ─── The transport both share ──────────────────────────────────────────────

interface ChoiceMessage {
  content?: unknown;
  tool_calls?: unknown;
}

interface Choice {
  message?: ChoiceMessage;
  finish_reason?: unknown;
}

type PostResult = { ok: true; choice: Choice } | { ok: false; error: string };

// One POST, and every way it can fail turned into a sentence. What it does not
// do is read the answer: whether an empty content or a truncated one is a
// problem depends on what was asked for, so that stays with the two callers
// above.
async function postChat(
  body: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<PostResult> {
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
        // The one parameter with no OpenAI counterpart, and it is not
        // optional here. V4 thinks by default, which breaks this call three
        // ways: the chain of thought comes back in reasoning_content and
        // leaves `content` empty or partial, the reasoning spends the token
        // ceiling before the answer starts, and temperature stops applying.
        // Off, it is the plain completion this file has always made.
        thinking: { type: "disabled" },
        // Scoring the same evidence twice should not give two answers, and
        // asking the copilot the same question twice should not either.
        temperature: 0,
        ...body,
      }),
      signal: AbortSignal.timeout(timeoutMs),
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
          timeoutMs / 1000,
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

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      error: "DeepSeek returned something that is not JSON. Try again.",
    };
  }

  const choice = (parsed as { choices?: Choice[] })?.choices?.[0];
  if (!choice) {
    return {
      ok: false,
      error:
        "DeepSeek's reply had no answer in it. Try again — if it keeps happening, the DeepSeek API has changed shape.",
    };
  }
  return { ok: true, choice };
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
