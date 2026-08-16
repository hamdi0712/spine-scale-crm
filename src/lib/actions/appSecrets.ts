"use server";

// Saving one API credential — the one write behind the API Keys form.
//
// It takes a key at a time, because that is how the form is used: an Edit is
// opened on one field, a value is pasted, and that field is saved. A single
// action that wrote both would need the other one posted alongside it, and the
// other one is never in the browser to post — which is the whole point.
//
// Everything crossing this boundary is untrusted and read through
// src/lib/appSecrets.ts: the name has to be one of the two keys that exist, and
// the value is trimmed, with empty becoming null so "clear this" ends up as the
// environment fallback rather than as an empty bearer header.
//
// It returns nothing. In particular it does not return the value it just
// stored, or a re-read of it — no server action in this app hands a credential
// back to the browser, and the page re-renders its masked form from the
// database instead.

import { revalidatePath } from "next/cache";
import { SECRET_KEYS, SecretKey, readSecretValue } from "@/lib/appSecrets";
import { saveSecret } from "@/lib/appSecretsStore";

function readSecretKey(value: FormDataEntryValue | null): SecretKey | null {
  return typeof value === "string" &&
    (SECRET_KEYS as readonly string[]).includes(value)
    ? (value as SecretKey)
    : null;
}

export async function saveAppSecret(formData: FormData): Promise<void> {
  const key = readSecretKey(formData.get("key"));
  // A post naming a field that does not exist is not a state worth reporting —
  // there is no path from the form that produces one. It writes nothing.
  if (!key) return;

  await saveSecret(key, readSecretValue(formData.get("value")));

  // The page that shows the masked value. Nothing else on the site renders a
  // key, and every caller reads the row live, so there is nothing further to
  // invalidate — a saved key is in force on the next request without one.
  revalidatePath("/settings/api-keys");
}
