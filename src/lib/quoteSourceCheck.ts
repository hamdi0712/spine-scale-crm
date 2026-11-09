// A hard check behind the quote prompts: the only scripture allowed on the
// dashboard or Monk Mode banner is the Quran and hadith. The prompts already
// say so; this catches a model that ignores them. A reply that fails is
// treated like an unreadable one, so the day's fallback is shown instead.

const BLOCKED_SOURCES = [
  // The Bible, by name and by book.
  /\bbible\b/i, /\bscripture\b/i, /\bgospel\b/i, /\btestament\b/i,
  /\b(genesis|exodus|leviticus|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|song of (solomon|songs)|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)\s+\d+(:\d+)?/i,
  /\b(jesus|christ|apostle paul|saint paul|st\.? paul|king solomon|king david)\b/i,
  // Other scriptures.
  /\btorah\b/i, /\btalmud\b/i, /\btanakh\b/i,
  /\bbhagavad\b/i, /\bgita\b/i, /\bvedas?\b/i, /\bupanishads?\b/i, /\bkrishna\b/i,
  /\bdhammapada\b/i, /\bsutta\b/i, /\bsutra\b/i, /\bbuddha\b/i,
  /\bguru granth\b/i, /\bbook of mormon\b/i, /\bavesta\b/i,
];

export function isAllowedQuoteSource(author: string): boolean {
  return !BLOCKED_SOURCES.some((re) => re.test(author));
}
