-- Two columns the rewritten sequence needs.
--
-- Lead.replyText holds what the prospect actually wrote back. The audit offer
-- is generated from it: answering what somebody said needs the words they used,
-- and "appreciate that context" written against an unread reply is the version
-- of that message that gets ignored. Nullable, because marking a reply without
-- keeping the text is still a legitimate thing to do, and the step then
-- acknowledges the reply without attributing anything to them.
--
-- OutreachMessage.internalNote holds the reviewer's note that every generated
-- step now returns: the evidence used, the hedging applied, and the stage that
-- had to be reached first. It is a column rather than a paragraph appended to
-- content, because a note that lives inside the message is a note that gets
-- pasted into LinkedIn along with it.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "replyText" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN "internalNote" TEXT;
