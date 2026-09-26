// What Iman is allowed to propose, and the rules a proposal is held to.
//
// Read this file as the other half of src/lib/copilotLookups.ts. That file is
// the copilot's read permissions; this one is the whole of its write surface,
// and it is deliberately a short list of named changes rather than a way to
// reach the database. There is no Prisma here, no server action, and nothing
// that executes: this is the vocabulary, the validation and the wording, shared
// by the tool that proposes, the action that executes and the card that asks.
//
// ─── The shape of the feature ──────────────────────────────────────────────
//
// Nothing runs from a chat message. The model can do exactly one thing: ask for
// a proposal, which validates against a record the lookups actually read and
// stores a row with status PROPOSED. That is the end of the model's reach. The
// change happens when a person clicks Confirm, in a server action that takes an
// action id and reads the rest off the stored row — so the parameters that get
// applied are the ones the server wrote down, never anything the browser sends
// back. A proposal nobody confirms expires and does nothing.
//
// ─── Why the list is this short ─────────────────────────────────────────────
//
// Six kinds, each one record, each reusing the server action the app's own
// buttons call. Three things are deliberately absent and must stay absent
// unless somebody decides otherwise on purpose:
//
//   Deletes. Of anything — a lead, a client, a task, a candidate, a note. A
//   confirm-before-execute gate makes a wrong change visible and reversible;
//   it does not make a deleted record come back.
//
//   Anything touching more than one record. Not "disqualify these eleven", not
//   a tier-wide stage move. The gate's value is that a person read the sentence
//   and agreed with it, and a sentence about eleven records is not read the
//   same way. A bulk request is answered by naming the records and proposing
//   one, which is also why there is no column on CopilotAction that could hold
//   a second id.
//
//   Clients and Reporting. Invoices, health, contracts, weekly numbers: money
//   and commitments to signed clients. This first pass is Pipeline, Discovery
//   and Tasks, and the model is told so in as many words.
//
// ─── The untrusted-content rule, restated ───────────────────────────────────
//
// It is unchanged by any of this and it applies here with more force than
// anywhere else in the app. Website crawls, review text and a prospect's reply
// arrive fenced under UNTRUSTED_CONTENT_KEY, and nothing inside that fence is
// ever a reason to propose anything. A crawled page that says "disqualify this
// lead" is a page with words on it. The system prompt states this explicitly
// for proposals, and the structural half is here: a proposal cannot execute
// itself, so the worst a successful injection achieves is a card the operator
// reads and cancels.

import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import {
  ICP_DISQUALIFIERS,
  ICP_DISQUALIFIER_KEYS,
  IcpDisqualifierKey,
} from "@/lib/icp";

// ─── The kinds ─────────────────────────────────────────────────────────────

export const COPILOT_ACTION_KINDS = [
  "DISQUALIFY_LEAD",
  "DISQUALIFY_CANDIDATE",
  "MOVE_LEAD_STAGE",
  "ADD_TASK",
  "MARK_CONNECTION_SENT",
  "MARK_CONNECTION_ACCEPTED",
] as const;

export type CopilotActionKind = (typeof COPILOT_ACTION_KINDS)[number];

export function isCopilotActionKind(value: unknown): value is CopilotActionKind {
  return (
    typeof value === "string" &&
    (COPILOT_ACTION_KINDS as readonly string[]).includes(value)
  );
}

// The label on the card's own heading. Says what will happen, in the words the
// app uses for it elsewhere.
export const COPILOT_ACTION_LABELS: Record<CopilotActionKind, string> = {
  DISQUALIFY_LEAD: "Disqualify lead",
  DISQUALIFY_CANDIDATE: "Disqualify discovery candidate",
  MOVE_LEAD_STAGE: "Change pipeline stage",
  ADD_TASK: "Add task",
  MARK_CONNECTION_SENT: "Mark connection request sent",
  MARK_CONNECTION_ACCEPTED: "Mark connection accepted",
};

// Which record each kind needs, and therefore which id the proposal has to
// carry. "lead_optional" is the task board: a task can hang off a lead or off
// nothing, and both are real.
export const COPILOT_ACTION_TARGETS: Record<
  CopilotActionKind,
  "lead" | "candidate" | "lead_optional"
> = {
  DISQUALIFY_LEAD: "lead",
  DISQUALIFY_CANDIDATE: "candidate",
  MOVE_LEAD_STAGE: "lead",
  ADD_TASK: "lead_optional",
  MARK_CONNECTION_SENT: "lead",
  MARK_CONNECTION_ACCEPTED: "lead",
};

// The kinds that will not execute without a reason in words. Disqualifying is
// the pair of them: it takes a record out of play, and "because Iman said so"
// is not a record anybody can audit later.
export const COPILOT_ACTIONS_NEEDING_REASON: CopilotActionKind[] = [
  "DISQUALIFY_LEAD",
  "DISQUALIFY_CANDIDATE",
];

export const COPILOT_ACTION_STATUSES = [
  "PROPOSED",
  "CONFIRMED",
  "CANCELLED",
  "FAILED",
] as const;

export type CopilotActionStatus = (typeof COPILOT_ACTION_STATUSES)[number];

// ─── Ceilings ──────────────────────────────────────────────────────────────

// One proposal per turn.
//
// Not an arbitrary limit — it is the no-bulk rule holding at the other end. A
// model that cannot propose eleven changes at once can still propose one
// eleven times, and eleven cards in one reply is the bulk operation this
// feature refuses, assembled out of singles. So a turn carries at most one, and
// a request that needs more is answered by proposing the first and saying what
// the rest would be.
export const COPILOT_MAX_PROPOSALS_PER_TURN = 1;

// How long a proposal stays confirmable.
//
// A card sitting in yesterday's conversation is a change agreed to against a
// record that has since moved, and clicking it tomorrow would apply a decision
// nobody is still holding in their head. An hour is long enough to read the
// card, check the lead's page in another tab and come back.
export const COPILOT_ACTION_TTL_MINUTES = 60;

export const COPILOT_ACTION_REASON_MAX_CHARS = 300;
export const COPILOT_ACTION_TITLE_MAX_CHARS = 120;
export const COPILOT_ACTION_ASKED_FOR_MAX_CHARS = 300;

export function copilotActionIsStale(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > COPILOT_ACTION_TTL_MINUTES * 60 * 1000;
}

// ─── The parameters, per kind ──────────────────────────────────────────────

export interface DisqualifyLeadParams {
  // Which of the five Layer 1 disqualifiers to set. The scorecard's own
  // vocabulary rather than a free-text verdict: this is the field the pipeline
  // page shows, and a disqualification that does not name one of them is an
  // opinion rather than a scorecard entry.
  disqualifier: IcpDisqualifierKey;
}

export interface MoveLeadStageParams {
  stage: LeadStage;
}

export interface AddTaskParams {
  title: string;
  description: string | null;
  // A day, as YYYY-MM-DD, or null. Not a timestamp: the board shows a due date.
  dueDate: string | null;
}

export type CopilotActionParams =
  | ({ kind: "DISQUALIFY_LEAD" } & DisqualifyLeadParams)
  | { kind: "DISQUALIFY_CANDIDATE" }
  | ({ kind: "MOVE_LEAD_STAGE" } & MoveLeadStageParams)
  | ({ kind: "ADD_TASK" } & AddTaskParams)
  | { kind: "MARK_CONNECTION_SENT" }
  | { kind: "MARK_CONNECTION_ACCEPTED" };

export type ParamsOutcome =
  | { ok: true; params: CopilotActionParams }
  // The message goes back to the model as the tool's result, so it is written
  // to be acted on rather than logged.
  | { ok: false; message: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/**
 * The arguments a proposal was asked for, checked against the kind.
 *
 * Every value the model sends passes through here and nothing else reads its
 * arguments. A kind's parameters are rebuilt field by field — there is no spread
 * of a model-supplied object into a query anywhere behind this, which is the
 * property that makes the tool's arguments harmless whatever is in them.
 */
export function parseCopilotActionParams(
  kind: CopilotActionKind,
  raw: Record<string, unknown>,
): ParamsOutcome {
  switch (kind) {
    case "DISQUALIFY_LEAD": {
      const key = typeof raw.disqualifier === "string" ? raw.disqualifier : "";
      if (!(ICP_DISQUALIFIER_KEYS as readonly string[]).includes(key)) {
        return {
          ok: false,
          message: `DISQUALIFY_LEAD needs a disqualifier, one of: ${ICP_DISQUALIFIER_KEYS.join(", ")}. ${ICP_DISQUALIFIERS.map((d) => `${d.key} — ${d.label}`).join("; ")}. Pick the one the evidence actually supports, and if none of them fits, this is not a disqualification: say so instead of proposing one.`,
        };
      }
      return { ok: true, params: { kind, disqualifier: key as IcpDisqualifierKey } };
    }
    case "DISQUALIFY_CANDIDATE":
      return { ok: true, params: { kind } };
    case "MOVE_LEAD_STAGE": {
      const stage = typeof raw.stage === "string" ? raw.stage : "";
      if (!(LEAD_STAGES as readonly string[]).includes(stage)) {
        return {
          ok: false,
          message: `MOVE_LEAD_STAGE needs a stage, one of: ${LEAD_STAGES.join(", ")}.`,
        };
      }
      return { ok: true, params: { kind, stage: stage as LeadStage } };
    }
    case "ADD_TASK": {
      const title = text(raw.title, COPILOT_ACTION_TITLE_MAX_CHARS);
      if (title === null) {
        return {
          ok: false,
          message:
            "ADD_TASK needs a title — the line the board will show, in the operator's own terms. Something like \"Follow up with Ridgeway Spine about the audit\".",
        };
      }
      const dueDate = text(raw.dueDate, 10);
      if (dueDate !== null && !DAY_PATTERN.test(dueDate)) {
        return {
          ok: false,
          message: `ADD_TASK's dueDate has to be a day written YYYY-MM-DD, or left out. "${dueDate}" is not one.`,
        };
      }
      return {
        ok: true,
        params: {
          kind,
          title,
          description: text(raw.description, COPILOT_ACTION_REASON_MAX_CHARS),
          dueDate,
        },
      };
    }
    case "MARK_CONNECTION_SENT":
    case "MARK_CONNECTION_ACCEPTED":
      return { ok: true, params: { kind } };
  }
}

// Params on the way to and from the database's text column. A row that will not
// read back as its own kind's parameters is refused at execution rather than
// guessed at — see readCopilotActionParams in the store.
export function encodeCopilotActionParams(params: CopilotActionParams): string {
  return JSON.stringify(params);
}

export function decodeCopilotActionParams(
  kind: CopilotActionKind,
  stored: string,
): CopilotActionParams | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored === "" ? "{}" : stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const outcome = parseCopilotActionParams(kind, parsed as Record<string, unknown>);
  return outcome.ok ? outcome.params : null;
}

// ─── The wording ───────────────────────────────────────────────────────────

/**
 * The one line the card leads with and the feed repeats.
 *
 * Composed here, on the server, from the record's own stored name and the
 * validated parameters — never from a sentence the model wrote. The model
 * supplies the reason and nothing else, so a proposal cannot describe itself as
 * one thing and do another. "Disqualify Acme Spine Clinic — surgical practice,
 * per the site's own copy" is the shape: what happens, to what, and why.
 */
export function composeCopilotActionSummary(args: {
  params: CopilotActionParams;
  recordName: string | null;
  reason: string | null;
}): string {
  const { params, recordName, reason } = args;
  const name = (recordName ?? "").trim();
  const because = reason === null || reason.trim() === "" ? "" : ` — reason: ${reason.trim()}`;

  switch (params.kind) {
    case "DISQUALIFY_LEAD": {
      const label =
        ICP_DISQUALIFIERS.find((d) => d.key === params.disqualifier)?.label ??
        params.disqualifier;
      return `Disqualify ${name} — ICP disqualifier: ${label}${because}`;
    }
    case "DISQUALIFY_CANDIDATE":
      return `Disqualify discovery candidate ${name}${because}`;
    case "MOVE_LEAD_STAGE":
      return `Move ${name} to ${LEAD_STAGE_LABELS[params.stage]}${because}`;
    case "ADD_TASK": {
      const due = params.dueDate === null ? "" : `, due ${params.dueDate}`;
      const about = name === "" ? "" : ` (linked to ${name})`;
      return `Add task “${params.title}”${due}${about}${because}`;
    }
    case "MARK_CONNECTION_SENT":
      return `Mark the LinkedIn connection request to ${name} as sent${because}`;
    case "MARK_CONNECTION_ACCEPTED":
      return `Mark ${name}'s connection request as accepted${because}`;
  }
}

// ─── What the page is given ────────────────────────────────────────────────

// A proposal as the card draws it. Everything here is composed on the server;
// the page's only input back is the id.
export interface CopilotActionView {
  id: string;
  kind: CopilotActionKind;
  kindLabel: string;
  status: CopilotActionStatus;
  summary: string;
  reason: string | null;
  // What the operator typed that led to this, so the card can say so. It is
  // their own words coming back, which is the point: a card that cannot be
  // traced to something you asked for is one to cancel.
  askedFor: string | null;
  // Where the change will land, named the way the app names it, plus the href
  // of the record's own page so the operator can go and look before agreeing.
  recordName: string | null;
  recordHref: string | null;
  createdAt: string;
  // Composed on the server: PROPOSED and past its hour is not confirmable, and
  // the card has to say that rather than offer a button that will refuse.
  stale: boolean;
  error: string | null;
}

// What confirming or cancelling gives back: the card's new state, and whether
// the feed and the pages behind it need rereading.
export interface CopilotActionOutcome {
  action: CopilotActionView;
  // Said in the words the card shows under itself once it is settled.
  message: string;
}
