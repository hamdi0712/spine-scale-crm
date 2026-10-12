// A scripted stand-in for src/lib/deepseek.ts's JSON call, keyed by clinic.
//
// tools/verify-icp-scoring.ts uses it to drive the ICP model's real code path —
// the prompt, the reply parser, the citation check, the guards and the verdict
// — without a model or an API key. Each reply is what a model reading that
// clinic's evidence would plausibly send, including the mistakes the guards
// exist for (an insurer list read as insurance-only, a quote that is not on
// the page, a hedge dressed as a finding). It answers the question "what does
// the app do with this reply", which is the half of the system the app owns;
// whether a real model writes these replies is the other half, and only a run
// with DEEPSEEK_API_KEY set answers it.
let replies = {};
const prompts = [];

exports.DEEPSEEK_MODEL = "scripted-stub";

exports.setReplies = (map) => {
  replies = { ...map };
};

exports.prompts = () => prompts;

exports.deepSeekJson = async ({ system, user }) => {
  prompts.push({ system, user });
  const match = /^CLINIC: (.+)$/m.exec(user);
  const name = match ? match[1].trim() : "";
  const reply = replies[name];
  if (reply === undefined) {
    return { ok: false, error: `The scripted model has no reply for “${name}”.` };
  }
  return { ok: true, content: typeof reply === "string" ? reply : JSON.stringify(reply) };
};

exports.deepSeekChat = async () => ({ ok: false, error: "Not scripted." });
