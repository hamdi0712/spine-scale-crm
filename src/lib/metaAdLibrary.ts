// The Meta Ad Library link on the lead page's Reach out buttons. A plain link,
// worked out from what the lead already holds: no API call, nothing to pay.
//
// The exact page when its numeric ID is known — stored by the ads check, or
// sitting in a profile.php?id= / people/Name/ID Facebook URL — and a search
// on the clinic's name when it isn't, labelled so the two never read alike.

import { hasActiveAds } from "@/lib/discovery";

const LIBRARY = "https://www.facebook.com/ads/library/";

export function facebookPageIdFromUrl(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (raw === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
  const id = parsed.searchParams.get("id");
  if (id && /^\d{5,25}$/.test(id)) return id;
  // facebook.com/people/Clinic-Name/1000123456789/ and the like.
  const tail = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  if (/^\d{5,25}$/.test(tail)) return tail;
  // facebook.com/Clinic-Name-1000123456789
  const dashed = /-(\d{10,25})$/.exec(tail);
  return dashed ? dashed[1] : null;
}

export interface MetaAdLibraryLink {
  href: string;
  label: string;
  exact: boolean;
}

export function metaAdLibraryLink(lead: {
  clinicName: string;
  facebookPageId?: string | null;
  facebookUrl?: string | null;
  metaAdsSignal?: string | null;
}): MetaAdLibraryLink {
  const pageId = (lead.facebookPageId ?? "").trim() || facebookPageIdFromUrl(lead.facebookUrl);
  const params = new URLSearchParams({ active_status: "active", ad_type: "all", country: "US" });
  if (pageId) {
    params.set("view_all_page_id", pageId);
  } else {
    params.set("q", lead.clinicName.trim());
    params.set("search_type", "keyword_unordered");
  }
  // "3 active ads, running 4mo" → 3; "50+ active ads" → 50+.
  const count = hasActiveAds(lead.metaAdsSignal) ? /^\s*(\d+\+?)/.exec(lead.metaAdsSignal ?? "")?.[1] : undefined;
  const label = `Meta Ads${pageId ? "" : " (search)"}${count ? ` · ${count} active` : ""}`;
  return { href: `${LIBRARY}?${params.toString()}`, label, exact: pageId !== null && pageId !== "" };
}
