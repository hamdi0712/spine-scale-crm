-- The outreach playbook: opener angle, short clinic name, per-follow-up
-- delays, and the new templates. The opt-out line, sign-off, sender name and
-- daily limits are kept as they are.
ALTER TABLE "Lead" ADD COLUMN "openerAngle" TEXT;
ALTER TABLE "Lead" ADD COLUMN "shortClinicName" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN "followUpDelaysDays" TEXT NOT NULL DEFAULT '[]';

UPDATE "EmailSettings" SET
  "subjectTemplate" = 'new patient booking',
  "frontDeskSubjectTemplate" = 'question for the doctor',
  "ownerBodyTemplate" = '{greeting}

{opener}

I wrote down a few things I’d change on the new patient side. Already on top of it, or want me to send them?',
  "frontDeskTemplate" = '{greeting}

{opener}

This one’s probably for {contactOrDoctor}. I wrote down a few things I’d change on the new patient side. Want me to send them over?',
  "followUpTemplates" = '["One other thing I’d check: when someone books a first visit and doesn’t show, does someone follow up every time, or does it depend on who’s at the front desk that day?", "I’ll leave it here. If new patient follow-up moves up the list, just reply here and I’ll send over what I’d change.\n\nThanks either way."]',
  "followUpDelaysDays" = '[3,5]',
  "updatedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE "id" = 'default';
