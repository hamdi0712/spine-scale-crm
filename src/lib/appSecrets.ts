// The two API credentials the app calls out with, and the rules about them.
//
// Pure, and safe to import from a client component: nothing in here reads a
// row, an environment variable or a network. It is the vocabulary the store
// (src/lib/appSecretsStore.ts), the save action and the Settings form all
// agree on — which keys exist, what each is called on screen, and what a
// browser is allowed to be told about one.
//
// The rule this module exists to hold is the last one. A key is never sent to
// the client in full, at any point, including immediately after it was saved.
// What the Settings page gets is maskSecret()'s output: whether something is
// set, and the last four characters, which is enough to answer "is this the
// key I think it is" and not enough to be one.

export const APP_SECRETS_ID = "singleton";

export const SECRET_KEYS = ["deepseekApiKey", "apifyApiToken"] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export interface SecretMeta {
  key: SecretKey;
  label: string;
  // The environment variable this falls back to when the column is null. Named
  // on the page so somebody who set it in .env can see which one is in force.
  envVar: string;
  help: string;
  placeholder: string;
}

export const SECRET_META: Record<SecretKey, SecretMeta> = {
  deepseekApiKey: {
    key: "deepseekApiKey",
    label: "DeepSeek API key",
    envVar: "DEEPSEEK_API_KEY",
    help: "Powers ICP scoring, the second look, outreach hooks and the AI Copilot.",
    placeholder: "sk-…",
  },
  apifyApiToken: {
    key: "apifyApiToken",
    label: "Apify API token",
    envVar: "APIFY_API_TOKEN",
    help: "Runs the enrichment actors and the Apify import.",
    placeholder: "apify_api_…",
  },
};

// What the browser is allowed to know about a stored key: that it is set, where
// it came from, and its last four characters.
export interface SecretStatus {
  key: SecretKey;
  // Set anywhere at all — database or environment. This is what the page uses
  // to decide between "Not set" and a masked value.
  set: boolean;
  // Which of the two is actually in force, so the page can say so plainly.
  source: "database" | "env" | "none";
  // "••••••••1f4a", or null when nothing is set.
  masked: string | null;
}

// Last four characters behind a run of dots. A value too short to mask that way
// is masked entirely rather than half-shown — a four-character key would
// otherwise be printed in full by the function whose job is not to.
export function maskSecret(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  const dots = "•".repeat(8);
  return trimmed.length <= 4 ? dots : `${dots}${trimmed.slice(-4)}`;
}

// Untrusted text from the settings form on its way to a column. Trimmed,
// because a pasted key drags whitespace in and a bearer header built from it
// would fail in a way that looks like a wrong key; empty becomes null, which is
// the "not set here, use the environment" state rather than an empty header.
export function readSecretValue(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
