// What the Website Content Crawler is asked for, and what is kept of its links.
//
// Two problems this exists to fix, both of which made the chiro "dedicated
// page" signal miss program pages that were really there:
//
//   The crawl read three pages in whatever order the crawler found them, so a
//   clinic's decompression page was read only if it happened to be one of the
//   first three links. Now the crawl is two passes: the home page alone, then
//   the links off it most likely to be a program page — anything whose URL or
//   link text mentions decompression, disc, sciatica, back pain, spine or
//   avoiding surgery — up to the page limit in Settings → Pipeline.
//
//   The crawler stripped nav, header and footer and stored plain text, so a
//   "Spinal Decompression" menu item left no trace. Now those sections are
//   kept, and every link on every crawled page is read out of the crawler's
//   markdown and stored, text and target, on websiteLinks.
//
// Pure: building the input, reading links, choosing what to follow. The two
// actor runs are made in src/lib/websiteCrawlRun.ts.

export interface WebsiteLink {
  text: string;
  url: string;
  // The crawled page the link was found on.
  page: string;
}

// The crawl's page limit, as Settings → Pipeline holds it.
export const DEFAULT_WEBSITE_CRAWL_PAGES = 6;
export const MIN_WEBSITE_CRAWL_PAGES = 1;
export const MAX_WEBSITE_CRAWL_PAGES = 12;

// How many clinics a bulk re-crawl crawls at once.
export const DEFAULT_RECRAWL_CONCURRENCY = 4;
export const MIN_RECRAWL_CONCURRENCY = 1;
export const MAX_RECRAWL_CONCURRENCY = 8;

export function readRecrawlConcurrency(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_RECRAWL_CONCURRENCY;
  return Math.min(Math.max(Math.round(n), MIN_RECRAWL_CONCURRENCY), MAX_RECRAWL_CONCURRENCY);
}

export function readWebsiteCrawlPages(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_WEBSITE_CRAWL_PAGES;
  return Math.min(Math.max(Math.round(n), MIN_WEBSITE_CRAWL_PAGES), MAX_WEBSITE_CRAWL_PAGES);
}

// ─── The input ─────────────────────────────────────────────────────────────

// The crawler's default strips nav, footer, header and banner regions before
// extracting anything, and its default HTML transformer (readable text) strips
// whatever looks like site chrome on top of that. Both are turned down here:
// only scripts, styles, inline images and pop-ups are removed, and the page is
// converted whole. The menu is where a clinic lists what it offers.
const KEEP_NAV_REMOVE_SELECTOR =
  'script, style, noscript, svg, img[src^="data:"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

export function crawlInput(startUrls: string[], maxPages: number) {
  return {
    startUrls: startUrls.map((url) => ({ url })),
    maxCrawlPages: maxPages,
    // The pages to read are chosen here, not discovered by the crawler: each
    // pass reads exactly the URLs it was handed.
    maxCrawlDepth: 0,
    // Not "cheerio": a chiropractic clinic's site is more often than not Wix,
    // Squarespace or a React template, and a crawler that runs no scripts gets
    // a shell with the copy missing. This fetches plainly first and starts a
    // browser only for the pages that turn out to need one.
    crawlerType: "playwright:adaptive",
    htmlTransformer: "none",
    removeElementsCssSelector: KEEP_NAV_REMOVE_SELECTOR,
    removeCookieWarnings: true,
    // Markdown keeps links as [text](url); it is where they are read from.
    saveMarkdown: true,
  };
}

// ─── Reading links ─────────────────────────────────────────────────────────

const MAX_LINKS = 400;
const LINK_TEXT_MAX = 160;

// [text](url) and [text](url "title"), but not ![image](url). Link text with
// nested brackets is rare on a clinic site and is skipped rather than guessed.
const MARKDOWN_LINK = /(?<!!)\[([^\][]{1,300})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export function linksFromMarkdown(markdown: string, pageUrl: string): WebsiteLink[] {
  const out: WebsiteLink[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MARKDOWN_LINK.source, "g");
  while ((m = re.exec(markdown)) !== null) {
    const text = m[1]
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/[*_`#]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LINK_TEXT_MAX);
    const url = absoluteUrl(m[2], pageUrl);
    if (!url) continue;
    out.push({ text, url, page: pageUrl });
  }
  return out;
}

// http(s) links, and mailto: ones — a "Email Dr. Smith" link is often the only
// place a clinic's address appears, read by the helpers in
// src/lib/emailFind.ts. Nothing that follows or cites pages takes a mailto:.
function absoluteUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base || undefined);
    if (u.protocol === "mailto:") return /@/.test(u.pathname) ? `mailto:${u.pathname}` : null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// One entry per link text and target, in the order they were found.
export function dedupeLinks(links: WebsiteLink[]): WebsiteLink[] {
  const seen = new Set<string>();
  const out: WebsiteLink[] = [];
  for (const link of links) {
    const key = `${link.text.toLowerCase()}|${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export function serializeLinks(links: WebsiteLink[]): string | null {
  const kept = dedupeLinks(links);
  return kept.length === 0 ? null : JSON.stringify(kept);
}

// A stored websiteLinks column back into links. Anything that is not a list
// of { text, url, page } reads as no links.
export function parseLinks(raw: string | null | undefined): WebsiteLink[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): WebsiteLink[] => {
      if (x === null || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      if (typeof o.url !== "string" || typeof o.text !== "string") return [];
      return [{ text: o.text, url: o.url, page: typeof o.page === "string" ? o.page : "" }];
    });
  } catch {
    return [];
  }
}

// ─── Choosing what to follow ───────────────────────────────────────────────

// The words that make a link worth following first.
export const PRIORITY_LINK_TERMS = [
  "decompression",
  "disc",
  "sciatica",
  "back pain",
  "spine",
  "spinal",
  "avoid surgery",
  "herniated",
];

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|mov|zip|docx?|xlsx?)$/i;
const SKIP_PATHS = /\/(wp-admin|wp-login|cart|checkout|login|account|feed|tag|category|author)(\/|$)/i;

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function mentions(text: string, terms: string[]): boolean {
  const w = words(text);
  return terms.some((t) => w.includes(` ${t} `) || w.includes(` ${t}s `));
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizePage(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url;
  }
}

// Pages where buying triggers show up — a job post, a new provider, an event.
export const TRIGGER_PAGE_TERMS = [
  "career",
  "careers",
  "job",
  "jobs",
  "hiring",
  "employment",
  "about",
  "about us",
  "team",
  "our team",
  "meet the team",
  "staff",
  "news",
  "blog",
  "events",
  "event",
  "seminar",
  "seminars",
  "workshops",
];

// The pages to read after the home page: on the clinic's own site, not files
// or account pages, each once — program links first, then the rest in the
// order the home page lists them (which is the menu's order, usually the
// clinic's own idea of what matters). When there are two or more slots, one
// is kept for a careers / jobs / about / team / news / events page if the
// home page links to one, so hiring, new-provider and seminar triggers have a
// page to be seen on.
export function choosePagesToFollow(
  links: WebsiteLink[],
  homeUrl: string,
  count: number,
): string[] {
  if (count <= 0) return [];
  const site = host(homeUrl);
  const home = normalizePage(homeUrl);
  const seen = new Set<string>([home]);
  const priority: string[] = [];
  const rest: string[] = [];
  let reserved: string | undefined;
  for (const link of links) {
    if (host(link.url) !== site) continue;
    if (SKIP_EXTENSIONS.test(new URL(link.url).pathname) || SKIP_PATHS.test(link.url)) continue;
    const key = normalizePage(link.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = decodeURIComponent(new URL(link.url).pathname);
    const said = `${link.text} ${path.replace(/[-_/]+/g, " ")}`;
    if (mentions(said, PRIORITY_LINK_TERMS)) priority.push(link.url);
    else if (count >= 2 && reserved === undefined && mentions(said, TRIGGER_PAGE_TERMS)) reserved = link.url;
    else rest.push(link.url);
  }
  const pool = [...priority, ...rest];
  const picked = pool.slice(0, count - (reserved ? 1 : 0));
  return reserved ? [...picked, reserved] : picked;
}

// ─── The chiro "dedicated page" signal, from a link ────────────────────────

// A link whose text or URL names a program page: decompression, disc,
// sciatica, or avoiding surgery. Word-bounded, so "discount" and "discover"
// are not "disc".
const PROGRAM_TERMS = ["decompression", "disc", "sciatica", "herniated", "herniation"];
const AVOID_SURGERY = /\b(avoid(ing)?\s+surgery|surgery\s+alternative|alternative\s+to\s+surgery|non\s+surgical)\b/;

export function isProgramLink(link: Pick<WebsiteLink, "text" | "url">): boolean {
  if (/^mailto:/i.test(link.url)) return false;
  let path = "";
  try {
    path = decodeURIComponent(new URL(link.url).pathname);
  } catch {
    path = link.url;
  }
  const haystack = `${link.text} ${path}`;
  return mentions(haystack, PROGRAM_TERMS) || AVOID_SURGERY.test(words(haystack));
}

// The same word-bounded test on a crawled page's own URL.
export function isProgramPageUrl(url: string): boolean {
  return isProgramLink({ text: "", url });
}

// ─── Junk links ────────────────────────────────────────────────────────────

// Link text that says nothing about where it goes: accessibility skips, menu
// toggles, "read more" buttons, bare punctuation. A link like that cannot be
// cited as evidence even when its URL happens to name a program.
const GENERIC_LINK_TEXT = new Set([
  "skip to main content",
  "skip to content",
  "skip to navigation",
  "skip",
  "menu",
  "open menu",
  "close menu",
  "toggle navigation",
  "close",
  "search",
  "close search",
  "open search",
  "learn more",
  "read more",
  "more",
  "click here",
  "here",
  "view more",
  "see more",
  "details",
  "next",
  "previous",
  "back to top",
]);

export function isGenericLinkText(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return t === "" || GENERIC_LINK_TEXT.has(t);
}

// A link back to the page it sits on (an in-page anchor, the logo on the home
// page): it is not evidence of another page.
export function isSelfLink(link: WebsiteLink): boolean {
  return link.page !== "" && normalizePage(link.url) === normalizePage(link.page);
}

// The links that count for the "dedicated page" signal: meaningful text, a
// different page, and a program named in the text or URL.
export function programLinks(links: WebsiteLink[]): WebsiteLink[] {
  return links.filter((l) => !isGenericLinkText(l.text) && !isSelfLink(l) && isProgramLink(l));
}

// ─── Provider links ────────────────────────────────────────────────────────

// A link to one provider's own page — /doctors/dr-trista-shelton/,
// /our-team/jane-doe-dc — named from the URL slug.
const PROVIDER_PATH = /\/(?:doctors?|providers?|our-doctors|our-team|team|staff|meet-the-team|meet-our-team|chiropractors?|physicians?)\/([a-z]+(?:-[a-z]+){1,4})\/?$/i;
const CREDENTIAL_SLUGS = new Set(["dc", "md", "do", "dpt", "pt", "np", "pa", "lac", "dr", "doctor"]);

export function providerNameFromLink(link: Pick<WebsiteLink, "url">): string | null {
  let path = "";
  try {
    path = decodeURIComponent(new URL(link.url).pathname);
  } catch {
    return null;
  }
  const m = path.match(PROVIDER_PATH);
  if (!m) return null;
  const parts = m[1].toLowerCase().split("-").filter((p) => !CREDENTIAL_SLUGS.has(p));
  if (parts.length < 2 || parts.length > 3) return null;
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
  return /^dr-/i.test(m[1]) ? `Dr. ${name}` : name;
}
