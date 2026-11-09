-- One-off: drop the dashboard and Monk Mode quotes saved for 9 Nov 2026, so the
-- day gets a fresh line chosen under the new Quran/hadith-only scripture rule.
DELETE FROM "DailyQuote" WHERE "id" >= '2026-11-09';
DELETE FROM "MonkModeQuote" WHERE "id" >= '2026-11-09';
