// Reading and writing the one secrets row.
//
// Server-only, and deliberately not a "use server" module — the same shape
// src/lib/pipelineSettingsStore.ts has, for the same reason: the DeepSeek
// client and the Apify client both read a key on their way out, and neither is
// an endpoint the browser is allowed to call. The form's save action lives in
// src/lib/actions/appSecrets.ts and comes through here too.
//
// Database first, environment second, and that order is the whole point of the
// table. A key saved on the Settings page is in force on the next request with
// no restart; an install that never opens the page has no row, falls through to
// .env, and behaves exactly as it did before this file existed.
//
// Nothing here is cached. A cached key would survive the save that replaced it,
// which is the one behaviour this was built to remove.

import { prisma } from "@/lib/prisma";
import {
  APP_SECRETS_ID,
  SECRET_KEYS,
  SECRET_META,
  SecretKey,
  SecretStatus,
  maskSecret,
} from "@/lib/appSecrets";

type SecretRow = { deepseekApiKey: string | null; apifyApiToken: string | null };

// A missing row is the normal state of a fresh install, so it reads as two
// nulls rather than as an error, and every caller below lands on the .env
// fallback without a special case.
async function loadRow(): Promise<SecretRow> {
  const row = await prisma.appSecrets.findUnique({
    where: { id: APP_SECRETS_ID },
    select: { deepseekApiKey: true, apifyApiToken: true },
  });
  return {
    deepseekApiKey: row?.deepseekApiKey ?? null,
    apifyApiToken: row?.apifyApiToken ?? null,
  };
}

function fromEnv(key: SecretKey): string | null {
  const value = process.env[SECRET_META[key].envVar]?.trim();
  return value === "" || value === undefined ? null : value;
}

// The one read every caller that needs an actual credential goes through.
// Returns null when neither source has one, which is what turns into the "not
// set" sentence at the call site — those sentences stay with the clients,
// because each names its own service.
export async function getSecret(key: SecretKey): Promise<string | null> {
  const row = await loadRow();
  const stored = row[key]?.trim();
  if (stored) return stored;
  return fromEnv(key);
}

export function getDeepseekApiKey(): Promise<string | null> {
  return getSecret("deepseekApiKey");
}

export function getApifyApiToken(): Promise<string | null> {
  return getSecret("apifyApiToken");
}

// What the Settings page renders. Never the values — the masked form, and which
// of the two sources is in force.
export async function loadSecretStatuses(): Promise<SecretStatus[]> {
  const row = await loadRow();
  return SECRET_KEYS.map((key) => {
    const stored = row[key]?.trim() || null;
    const value = stored ?? fromEnv(key);
    return {
      key,
      set: value !== null,
      source: stored ? "database" : value ? "env" : "none",
      masked: maskSecret(value),
    } satisfies SecretStatus;
  });
}

// An upsert on the fixed id, so saving from a fresh install creates the row and
// saving again updates it. Only the key being edited is touched: the form posts
// one field at a time, and a blanket write would clear the other column back to
// its environment fallback as a side effect of saving this one.
//
// A null clears the column, which is how the "Clear" path hands a key back to
// .env rather than storing an empty string that would go out as an empty
// bearer header.
export async function saveSecret(
  key: SecretKey,
  value: string | null,
): Promise<void> {
  await prisma.appSecrets.upsert({
    where: { id: APP_SECRETS_ID },
    create: { id: APP_SECRETS_ID, [key]: value },
    update: { [key]: value },
  });
}
