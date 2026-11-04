-- The front-desk email names the person it is for: {contact} is the lead's
-- contact by name ("Dr. Lee"), or "the doctor or owner" when it has none — so
-- with no contact the line reads exactly as before. Only that one sentence is
-- changed, and only where the saved template still has it word for word: a
-- template edited since is left as it is.
UPDATE "EmailSettings"
SET "frontDeskTemplate" = replace("frontDeskTemplate", 'This is probably a question for the doctor or owner.', 'This is probably a question for {contact}.'),
    "updatedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE instr("frontDeskTemplate", 'This is probably a question for the doctor or owner.') > 0;
