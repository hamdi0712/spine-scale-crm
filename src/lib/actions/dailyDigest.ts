"use server";

// The dashboard note's one call.
//
// Counts the day, asks DeepSeek which of it matters most, and caches the
// paragraph for DIGEST_MAX_AGE_MS. The card calls this on mount when what it
// was rendered with has gone stale, and again whenever somebody presses
// Refresh.
//
// Two things it writes, and nothing else: the note and the counts it was
// written from, both onto the single DailyDigest row. It touches no client, no
// lead and no candidate — the numbers are read, weighed, and put back as
// prose. There is no prisma.client.update in this file and there should never
// be one.
//
// The cache is checked on the server rather than trusted from the browser. A
// card that has been open in a tab since this morning will ask on mount; the
// answer is the note that is already stored, not a second call for the same
// four hours.

import { deepSeekJson } from "@/lib/deepseek";
import {
  DigestResult,
  buildDigestPrompt,
  isDigestFresh,
  parseDigestNote,
} from "@/lib/dailyDigest";
import { countDigestSnapshot, loadDigest, saveDigest } from "@/lib/digestStore";

export async function generateDailyDigest(
  // True only for the Refresh button. The automatic call the card makes when it
  // loads leaves this false, so a stale card that several tabs open at once
  // costs one generation and not one each.
  force = false,
): Promise<DigestResult> {
  const now = new Date();

  if (!force) {
    const cached = await loadDigest();
    if (isDigestFresh(cached, now) && cached) {
      return {
        ok: true,
        body: cached.body,
        snapshot: cached.snapshot,
        generatedAt: cached.generatedAt.toISOString(),
      };
    }
  }

  const snapshot = await countDigestSnapshot(now);
  const { system, user } = buildDigestPrompt(snapshot);
  const reply = await deepSeekJson({ system, user });
  if (!reply.ok) {
    return { ok: false, error: reply.error };
  }

  const body = parseDigestNote(reply.content);
  if (!body) {
    return {
      ok: false,
      error:
        "DeepSeek answered, but not in a shape that reads as a note. Nothing has been stored — try again.",
    };
  }

  // Stored before it is returned, so the next page load reads this paragraph
  // rather than paying for the same one again. Not swallowed if it fails: a
  // note the card shows but the cache never took would be generated afresh on
  // every load, quietly, which is the one failure worth hearing about.
  await saveDigest({ body, snapshot, generatedAt: now });

  return { ok: true, body, snapshot, generatedAt: now.toISOString() };
}
