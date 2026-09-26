// A scripted stand-in for src/lib/deepseek.ts, so the copilot's real tool loop
// can be driven without a model or an API key.
//
// It exists for one test that cannot be written any other way. The question
// "does a prompt injection in scraped website copy produce an action proposal"
// has two halves: whether the model obeys the injected text, which only a real
// model can answer, and what happens to the app if it does, which is the half
// that has to hold whatever the model does. This stub answers the second half by
// playing a model that has been completely taken in — it reads the injected
// instruction and does exactly what it says — and lets the assertions show that
// the records are still untouched afterwards.
//
// Replies are queued by the test through setScript() and returned in order.
let script = [];

exports.setScript = (replies) => {
  script = [...replies];
};

exports.scriptRemaining = () => script.length;

exports.deepSeekChat = async () => {
  if (script.length === 0) {
    return { ok: false, error: "The scripted model ran out of replies." };
  }
  const next = script.shift();
  return {
    ok: true,
    content: next.content ?? null,
    toolCalls: (next.toolCalls ?? []).map((call, index) => ({
      id: `call_${index}_${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    })),
  };
};
