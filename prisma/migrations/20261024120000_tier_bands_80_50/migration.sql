-- New-model tier bands: A 80–100, B 50–79, C 0–49 (were A 80+, B 60–79, C below 60).
--
-- A lead's tier is read from its stored breakdown and re-banded in code
-- (tierFor in src/lib/icpScoring.ts), so leads need nothing here. A candidate
-- stores its tier in its own column, which Discovery and the Daily KPI read,
-- so it is re-banded from the stored score. No re-scoring: rejections by rule
-- (not a confirmed fit, chiro without a real program, not enough evidence)
-- and disqualifications keep their tier, exactly as tierFor decides.
UPDATE "DiscoveryCandidate"
SET "icpTier" = CASE
    WHEN "icpTotal" >= 80 THEN 'A'
    WHEN "icpTotal" >= 50 THEN 'B'
    ELSE 'C'
  END
WHERE "scoringModel" = 'v2'
  AND "icpTotal" IS NOT NULL
  AND "icpTier" IN ('A', 'B', 'C')
  AND "icpBreakdown" IS NOT NULL
  AND json_extract("icpBreakdown", '$.verdict.kind') IN ('promoted', 'below_threshold');
