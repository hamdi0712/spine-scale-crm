// The clinic's contact page, picked from the links the crawler already
// stored (websiteLinks) — for the lead page's "Contact form" button.
//
//   Only the clinic's own site: an http(s) link on the same domain as its
//   website. A booking widget on another domain is not its contact form.
//   The link's text or its path has to say contact, contact us, appointment,
//   schedule, request or book. "Contact" wins over the others; between two of
//   the same kind, the first one found.
//   Nothing that matches: no button.
//
// Pure.

import { clinicDomain } from "@/lib/emailFind";
import { parseLinks } from "@/lib/websiteCrawl";

// In order of preference. "contact us" is "contact".
const CONTACT_TERMS: RegExp[] = [/contact/i, /appointment|schedul|request|\bbook/i];

function sameSite(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

export function pickContactFormLink(websiteLinks: string | null, websiteUrl: string | null): string | null {
  const domain = clinicDomain(websiteUrl);
  if (!domain) return null;
  const links = parseLinks(websiteLinks).flatMap((l) => {
    try {
      const url = new URL(l.url);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !sameSite(url, domain)) return [];
      // The path and query only: the domain itself says nothing about the page.
      const path = decodeURIComponent(`${url.pathname}${url.search}`).replace(/[-_/]+/g, " ");
      return [{ url: url.toString(), said: `${l.text} ${path}` }];
    } catch {
      return [];
    }
  });
  for (const term of CONTACT_TERMS) {
    const hit = links.find((l) => term.test(l.said));
    if (hit) return hit.url;
  }
  return null;
}
