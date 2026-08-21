"use server";

// The copilot's one call, and the loop around it.
//
// The panel sends the conversation so far and the question just typed. This
// asks DeepSeek, runs whatever lookups it asks for, asks again with the
// results, and repeats until the model answers in prose or the round ceiling
// is reached. Then it hands back the answer and the names of the lookups that
// produced it.
//
// Two things are worth being explicit about, because they are the security
// posture rather than implementation detail.
//
//   The browser never sends a tool result. It sends prose turns and nothing
//   else (CopilotTurn in src/lib/copilot.ts), and the tool messages in the
//   request below are built here from lookups that actually ran in this call.
//   A page that has been tampered with can therefore ask a leading question,
//   which is fine — it cannot fabricate an answer from the database.
//
//   Nothing this action can reach writes. Every lookup lives in
//   src/lib/copilotLookups.ts behind a fixed dispatcher, and that file has no
//   write in it. This action does not touch Prisma itself, does not
//   revalidate a path, and returns text. There is deliberately no branch here
//   that could ever become one.
//
// Nothing throws out of this function. Every failure — no key, a refused
// request, a lookup that blew up, a model that kept looking things up and
// never answered — comes back as { ok: false } with a sentence, the same
// contract every other AI feature in the app is held to.

import {
  COPILOT_MAX_CALLS_PER_ROUND,
  COPILOT_MAX_TOOL_ROUNDS,
  COPILOT_QUESTION_MAX_CHARS,
  COPILOT_TOOLS,
  CopilotResult,
  buildCopilotSystemPrompt,
  sanitiseHistory,
} from "@/lib/copilot";
import { runCopilotTool } from "@/lib/copilotLookups";
import { readBusinessContextBody } from "@/lib/businessContextStore";
import { DeepSeekChatMessage, deepSeekChat } from "@/lib/deepseek";

export async function askCopilot(
  question: string,
  history: unknown,
): Promise<CopilotResult> {
  const asked = typeof question === "string" ? question.trim() : "";
  if (asked === "") {
    return { ok: false, error: "Ask a question and the copilot will answer it." };
  }

  // The operator's standing context, read live so a rule typed in Settings
  // applies to the next question rather than the next restart. An empty page
  // composes to exactly the prompt this action sent before the page existed,
  // and it costs no tool call either way — this is instruction, not a lookup.
  const businessContext = await readBusinessContextBody();

  const messages: DeepSeekChatMessage[] = [
    { role: "system", content: buildCopilotSystemPrompt(businessContext) },
    ...sanitiseHistory(history).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: asked.slice(0, COPILOT_QUESTION_MAX_CHARS) },
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round < COPILOT_MAX_TOOL_ROUNDS; round++) {
    const reply = await deepSeekChat({ messages, tools: COPILOT_TOOLS });
    if (!reply.ok) {
      return { ok: false, error: reply.error };
    }

    // Prose rather than lookups: this is the answer.
    if (reply.toolCalls.length === 0) {
      const answer = (reply.content ?? "").trim();
      if (answer === "") {
        return {
          ok: false,
          error:
            "DeepSeek came back with nothing to show. Try asking the question again.",
        };
      }
      return { ok: true, answer, toolsUsed };
    }

    // A reply asking for a dozen lookups at once is a loop starting, not a
    // question being answered. Refusing the round outright would waste the
    // work already done, so the first few run and the rest are declined in
    // words the model can act on.
    const calls = reply.toolCalls.slice(0, COPILOT_MAX_CALLS_PER_ROUND);

    // The assistant turn has to go back in before its results do — a tool
    // message with no tool_call to answer is rejected by the API.
    messages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: calls,
    });

    for (const call of calls) {
      let content: string;
      try {
        const outcome = await runCopilotTool(
          call.function.name,
          call.function.arguments,
        );
        content = outcome.ok
          ? safeStringify(outcome.data)
          : JSON.stringify({ error: outcome.message });
        if (outcome.ok && !toolsUsed.includes(call.function.name)) {
          toolsUsed.push(call.function.name);
        }
      } catch (err) {
        // A lookup that threw is this app's fault, not the model's, and it is
        // not something another round will fix. The conversation stops here
        // and says which lookup broke.
        console.error(`Copilot lookup ${call.function.name} failed`, err);
        return {
          ok: false,
          error: `Looking up ${call.function.name} failed, so the question was not answered. The server log has the detail — nothing has been changed.`,
        };
      }
      messages.push({
        role: "tool",
        content,
        tool_call_id: call.id,
      });
    }

    // Said as a system note rather than as a tool result, because the calls
    // that were dropped are not in the assistant turn above — a tool message
    // answering a tool_call the conversation does not contain is rejected.
    if (reply.toolCalls.length > calls.length) {
      messages.push({
        role: "system",
        content: `Only the first ${COPILOT_MAX_CALLS_PER_ROUND} lookups of that reply were run; the rest were dropped. Answer with what you have, or ask for one more at a time.`,
      });
    }
  }

  return {
    ok: false,
    error: `The copilot kept looking things up and did not reach an answer within ${COPILOT_MAX_TOOL_ROUNDS} rounds. Nothing has been changed. Try a narrower question — one client, one tier or one week at a time.`,
  };
}

// Tool results go back as JSON text. A value that will not stringify — a
// circular structure, a BigInt — must not take the whole conversation down
// with it, so it comes back as an error the model can report.
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data ?? null);
  } catch {
    return JSON.stringify({
      error:
        "That lookup returned something that could not be read. Tell the operator this lookup is not answering and answer what you can without it.",
    });
  }
}
