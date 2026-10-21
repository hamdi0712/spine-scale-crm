// "Export for review" on the Pipeline page: every active lead as one CSV row,
// with the dates a weekly review asks about and one computed status flag.
//
// Active means the default Pipeline view (not archived, not flagged "Rejected
// by new scoring") minus Lost. The rows are built here from plain data so the
// route is only the read and the download, and the rules for the flag and for
// "last touch" live in one place.
//
// The file has to read three ways: opened in Excel, opened in a text editor,
// and pasted into a chat. So dates are YYYY-MM-DD, every value is one line
// (line breaks in replies and notes are folded to spaces), and the file starts
// with a BOM so Excel reads it as UTF-8 rather than mangling an em dash.

import { LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { ICP_TIER_LABELS } from "@/lib/icp";
import { LeadScoreInput, leadScoreText, leadTier } from "@/lib/leadScore";
import {
  MESSAGE_MECHANISM_LABELS,
  OUTREACH_STEPS,
  OUTREACH_STEP_LABELS,
  isMessageMechanism,
  isOutreachStep,
} from "@/lib/outreachSequence";

export type ExportLead = LeadScoreInput & {
  clinicName: string;
  contactName: string | null;
  stage: string;
  linkedinUrl: string | null;
  connectionRequestSentAt: Date | null;
  connectionAcceptedAt: Date | null;
  repliedAt: Date | null;
  replyText: string | null;
  stageChangedAt: Date;
  nextFollowUp: Date | null;
  outreach: { step: string; messageMechanism: string | null; sentAt: Date | null }[];
  notes: { body: string; createdAt: Date }[];
  calls: { createdAt: Date }[];
};

// In sort order: the first is the one to deal with first. A lead carries the
// first flag that applies to it, never more than one.
export const STATUS_FLAGS = [
  "Accepted, no message sent",
  "Replied, no response from me",
  "Follow-up overdue",
  "No touch in 7+ days",
] as const;

export type StatusFlag = (typeof STATUS_FLAGS)[number];

export const STALE_TOUCH_DAYS = 7;

const HEADERS = [
  "Clinic name",
  "Contact name",
  "Tier",
  "ICP score",
  "Stage",
  "LinkedIn URL",
  "Connection request sent",
  "Connection accepted",
  "Last outreach step sent",
  "Last outreach step sent date",
  "Last Step 2 mechanism",
  "Replied",
  "Reply text",
  "Last touch",
  "Days since last touch",
  "Next follow-up",
  "Notes",
  "Status flag",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function latest(dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

function oneLine(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

interface Row {
  cells: string[];
  flag: StatusFlag | null;
  daysSinceTouch: number;
}

export function exportRow(lead: ExportLead, now: Date = new Date()): Row {
  const sent = lead.outreach
    .filter((m): m is typeof m & { sentAt: Date } => m.sentAt !== null)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const lastSent = sent[0] ?? null;
  const lastStep2 = sent.find((m) => m.step === "FIRST_MESSAGE") ?? null;

  // "Step 2 · First message" — the number is how the sequence is talked
  // about, the label is what it is.
  const stepText = (step: string) =>
    isOutreachStep(step)
      ? `Step ${OUTREACH_STEPS.indexOf(step) + 1} · ${OUTREACH_STEP_LABELS[step]}`
      : step;

  // Most recent of: a message sent (the connection request included, which is
  // marked on the lead rather than always as a message), a reply, a call
  // logged, a note added, or a stage change.
  const lastTouch = latest([
    ...sent.map((m) => m.sentAt),
    lead.connectionRequestSentAt,
    lead.repliedAt,
    ...lead.calls.map((c) => c.createdAt),
    ...lead.notes.map((n) => n.createdAt),
    lead.stageChangedAt,
  ]);
  const daysSinceTouch = lastTouch
    ? Math.max(0, Math.floor((now.getTime() - lastTouch.getTime()) / DAY_MS))
    : 0;

  const sentAfter = (d: Date) => sent.some((m) => m.sentAt > d);
  let flag: StatusFlag | null = null;
  if (
    lead.connectionAcceptedAt &&
    !lead.repliedAt &&
    !sent.some((m) => m.step !== "CONNECTION")
  ) {
    flag = "Accepted, no message sent";
  } else if (lead.repliedAt && !sentAfter(lead.repliedAt)) {
    flag = "Replied, no response from me";
  } else if (lead.nextFollowUp && ymd(lead.nextFollowUp) < ymd(now)) {
    flag = "Follow-up overdue";
  } else if (daysSinceTouch >= STALE_TOUCH_DAYS) {
    flag = "No touch in 7+ days";
  }

  const tier = leadTier(lead);
  const mechanism = lastStep2?.messageMechanism ?? null;

  return {
    flag,
    daysSinceTouch,
    cells: [
      lead.clinicName,
      lead.contactName ?? "",
      tier ? ICP_TIER_LABELS[tier] : "",
      leadScoreText(lead) ?? "",
      LEAD_STAGE_LABELS[lead.stage as LeadStage] ?? lead.stage,
      lead.linkedinUrl ?? "",
      ymd(lead.connectionRequestSentAt),
      ymd(lead.connectionAcceptedAt),
      lastSent ? stepText(lastSent.step) : "",
      ymd(lastSent?.sentAt),
      mechanism ? (isMessageMechanism(mechanism) ? MESSAGE_MECHANISM_LABELS[mechanism] : mechanism) : "",
      ymd(lead.repliedAt),
      oneLine(lead.replyText),
      ymd(lastTouch),
      lastTouch ? String(daysSinceTouch) : "",
      ymd(lead.nextFollowUp),
      // Oldest first, so the notes read as the story of the lead.
      [...lead.notes]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((n) => `${ymd(n.createdAt)}: ${oneLine(n.body)}`)
        .join(" | "),
      flag ?? "",
    ].map(oneLine),
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Flagged rows first, in STATUS_FLAGS order, then blank; within each group the
// longest since last touch first.
export function pipelineExportCsv(leads: ExportLead[], now: Date = new Date()): string {
  const rank = (f: StatusFlag | null) => (f ? STATUS_FLAGS.indexOf(f) : STATUS_FLAGS.length);
  const rows = leads
    .map((l) => exportRow(l, now))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || b.daysSinceTouch - a.daysSinceTouch);
  const lines = [HEADERS, ...rows.map((r) => r.cells)].map((cells) =>
    cells.map(csvCell).join(","),
  );
  return "﻿" + lines.join("\r\n") + "\r\n";
}
