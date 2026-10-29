-- AlterTable
-- The front desk gets its own subject, and every email a sign-off after the
-- opt-out line.
ALTER TABLE "EmailSettings" ADD COLUMN "frontDeskSubjectTemplate" TEXT NOT NULL DEFAULT 'Quick question about {clinic}';
ALTER TABLE "EmailSettings" ADD COLUMN "signOff" TEXT NOT NULL DEFAULT '{sender}';

-- The final copy, saved as the templates — edited ones, so the starter-copy
-- banner goes. Written over whatever the row held; the sender name and the
-- daily limit are kept, and follow-ups go three days apart (day 3, day 6).
INSERT INTO "EmailSettings" ("id", "subjectTemplate", "frontDeskSubjectTemplate", "ownerBodyTemplate", "frontDeskTemplate", "optOutLine", "followUpTemplates", "signOff", "followUpDelayDays", "updatedAt")
VALUES ('default', 'quick question about new patient follow-up', 'question for the doctor', '{greeting}

{opener}

I work with spine and disc clinics on what happens after someone reaches out: how fast they hear back, reminders before the first visit, and what happens when a call gets missed or someone goes quiet.

I’m curious how that works at {clinic} right now. When a new patient inquiry comes in after hours, who follows up, and how soon?', '{greeting}

{opener}

I work with spine and disc clinics on new patient follow-up: how fast people hear back after they reach out, reminders before the first visit, and catching missed calls.

This is probably a question for the doctor or owner. Would you mind passing it along?

The question is: when a new patient inquiry comes in after hours, who follows up, and how soon?', 'If this isn’t relevant, just reply “no” and I won’t email again.', '["Just bumping this up in case it got buried. Curious how after-hours inquiries get handled at {clinic}, even a one-line answer helps.", "I’ll leave it here so I’m not cluttering your inbox. If new patient follow-up ever becomes a priority, just reply to this thread and I’ll pick it up.\n\nThanks either way."]', '{sender}
Spine Scale
One Archers’ Place, East Tower
Taft Avenue corner Castro Street, Malate
Manila 1004, Philippines', 3, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT("id") DO UPDATE SET
  "subjectTemplate" = excluded."subjectTemplate",
  "frontDeskSubjectTemplate" = excluded."frontDeskSubjectTemplate",
  "ownerBodyTemplate" = excluded."ownerBodyTemplate",
  "frontDeskTemplate" = excluded."frontDeskTemplate",
  "optOutLine" = excluded."optOutLine",
  "followUpTemplates" = excluded."followUpTemplates",
  "signOff" = excluded."signOff",
  "followUpDelayDays" = 3,
  "updatedAt" = excluded."updatedAt";
