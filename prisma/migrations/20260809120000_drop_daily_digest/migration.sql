-- The dashboard's AI notes card is gone, and this table was only ever its
-- cache: one row holding the last paragraph a model wrote and the counts it was
-- written from. Nothing else read it, nothing referenced it, and every number
-- it held was counted live from the records that own them — so dropping it
-- loses a paragraph and no information.

-- DropTable
DROP TABLE IF EXISTS "DailyDigest";
