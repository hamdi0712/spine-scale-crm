"use client";

// The outreach sequence — five steps, one at a time, in the order they happen.
//
// It replaces the single "Generate outreach hook" button that used to sit in
// the outreach row. That button drafted one line; this drafts the whole
// sequence, one step at a time, and each step waits for the thing that has to
// happen before it makes sense: a request accepted, a reply, a Loom recorded, a
// follow-up date come round.
//
// The five steps were five stacked cards down the page, which meant the one
// step you could actually act on was somewhere in the middle of four you could
// not, and the panel was the length of the four locked reasons put together.
// They are a stepper now: a row of tabs across the top, the active step's
// content and only the active step's content below it, and the locked steps
// collapsed into one tight "What's next" list at the foot — a line each, saying
// what would unlock them. The content of a step is unchanged; what changed is
// how much of the page a step you cannot use is allowed to take.
//
// What has not changed is the promise underneath. Nothing here sends anything.
// Every message is text in a box for somebody to read, edit and copy, and every
// state this app knows about is a mark somebody made after doing something on
// LinkedIn themselves. A locked step says plainly what would unlock it rather
// than being merely greyed out, because "why can't I press this" is the only
// question a disabled control ever raises.
//
// Everything is type="button" and no textarea is named: this renders inside the
// lead's details form, where a stray submit or a stray field would save the lead
// as a side effect of drafting a message.

import { useState, useTransition } from "react";
import { IconCheck, IconChevronRight, IconLock } from "@tabler/icons-react";
import {
  CONTACT_NAME_PLACEHOLDER,
  CONTACT_LAST_NAME_PLACEHOLDER,
  CONNECTION_MAX_CHARS,
  OUTREACH_STEPS,
  OUTREACH_STEP_BLURBS,
  OUTREACH_STEP_LABELS,
  OUTREACH_STEP_TAB_LABELS,
  OutreachStep,
  SequenceState,
  VARIANT_BLURBS,
  FirstMessageVariant,
  MESSAGE_MECHANISM_LABELS,
  MessageMechanism,
  StepLock,
  endsInQuestion,
  stepLock,
} from "@/lib/outreachSequence";
import {
  OutreachMessageView,
  OutreachStepResult,
  currentMessages,
} from "@/lib/outreachSequenceRead";
import AiButton from "@/components/AiButton";
import MechanismPicker from "@/components/MechanismPicker";

export interface SequenceActions {
  generate: (step: string) => Promise<OutreachStepResult>;
  // The error the mark refused with, or null where it went through. The one
  // thing it refuses is a first message with no opener type on it.
  markSent: (messageId: string) => Promise<string | null>;
  setMechanism: (messageId: string, mechanism: string) => Promise<void>;
  clearSent: (messageId: string) => Promise<void>;
  saveContent: (messageId: string, content: string) => Promise<void>;
  markAccepted: () => Promise<void>;
  clearAccepted: () => Promise<void>;
  markReplied: () => Promise<void>;
  clearReplied: () => Promise<void>;
}

// What a step is saying about its last run, held per step so generating step 3
// does not clear the note under step 1.
// TEMPORARY, paired with OutreachStepResult.debug: the lines the step logged
// about what actually ran. Every shape of note carries them, because the ones
// worth reading a trace for are the two that wrote nothing.
type StepNote = { debug: string[] } & (
  | { kind: "error"; message: string }
  | { kind: "none"; basedOn: string[] }
  | {
      kind: "evidence";
      evidence: string | null;
      basedOn: string[];
      // How many messages the run actually wrote. Only interesting on the first
      // message, where three were asked for and anything less is worth saying
      // out loud rather than leaving somebody to count the boxes.
      written: number;
      // Which first-message variants the evidence could not support.
      skipped: readonly string[];
      // Which mechanism the run wrote by. Interesting on the two steps that
      // have more than one: the first message, where a curiosity opener can
      // arrive in place of three observations, and the follow-up, where a step 2
      // bump can arrive in place of a new-angle one. Either way it is a
      // different kind of message than the button offered, and worth saying so.
      mechanism: MessageMechanism | null;
    }
);

// One step as the stepper sees it: its gate, its drafts, and whether it is done.
interface StepEntry {
  step: OutreachStep;
  index: number;
  lock: StepLock;
  messages: OutreachMessageView[];
  sent: boolean;
}

export default function OutreachSequencePanel({
  messages,
  state,
  actions,
  acceptedLabel,
  repliedLabel,
  salutationNote,
}: {
  messages: OutreachMessageView[];
  state: SequenceState;
  actions: SequenceActions;
  // Formatted on the server and passed in already written, so both sides of
  // hydration render the same string — these stamps are often seconds old.
  acceptedLabel: string | null;
  repliedLabel: string | null;
  // How every message in the sequence greets this person, and what decided it.
  // Worth stating up here: "Hi Dr. Chen" is the kind of thing you want to have
  // agreed with before it is pasted into a stranger's inbox, not to discover in
  // the message. Editing the box still overrides it either way.
  salutationNote: string;
}) {
  const [notes, setNotes] = useState<Partial<Record<OutreachStep, StepNote>>>(
    {},
  );

  const entries: StepEntry[] = OUTREACH_STEPS.map((step, index) => {
    const stepMessages = currentMessages(messages, step);
    return {
      step,
      index,
      lock: stepLock(step, state),
      messages: stepMessages,
      sent: stepMessages.some((m) => m.sentAt !== null),
    };
  });
  const open = entries.filter((e) => e.lock.unlocked);
  const locked = entries.filter((e) => !e.lock.unlocked);

  // Where the panel opens: the first step that is reachable and not yet sent,
  // which is the one thing there is to do. Falling back to the last reachable
  // step rather than the first, because on a sequence where everything has gone
  // out the interesting end is the far one.
  const [picked, setPicked] = useState<OutreachStep | null>(
    () =>
      (open.find((e) => !e.sent) ?? open[open.length - 1])?.step ?? null,
  );
  // A mark can be undone, and undoing one locks a step that may be the one on
  // screen. Resolved on every render rather than in an effect: the tab simply
  // moves to a step that still exists instead of rendering a panel for a step
  // whose gate has closed behind it.
  const active =
    open.find((e) => e.step === picked) ?? open[open.length - 1] ?? null;

  return (
    <div className="w-full">
      {/* The two marks that gate everything below them. They sit at the top
          because that is the order they happen in — accepted, then replied —
          and because a locked step's reason points up here. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-wash/50 px-4 py-3">
        <p className="mr-1 text-xs font-medium">Where this stands</p>
        <MarkToggle
          label={acceptedLabel}
          idle="Mark connection accepted"
          title="Records that they accepted on LinkedIn. Nothing is sent."
          mark={actions.markAccepted}
          clear={actions.clearAccepted}
        />
        <MarkToggle
          label={repliedLabel}
          idle="Mark they replied"
          title="Records that they wrote back. Nothing is sent."
          mark={actions.markReplied}
          clear={actions.clearReplied}
        />
        <p className="w-full text-xs leading-relaxed text-muted">
          {salutationNote}
        </p>
      </div>

      {/* The stepper. All five steps are named, so the shape of the sequence is
          visible from the first one — but only the reachable ones are buttons,
          and a locked tab's reason is in the list at the foot rather than
          behind a tab that would open onto nothing.

          Scrolls sideways rather than wrapping: five tabs at a phone's width do
          not fit, and a stepper that reflows into two rows stops reading as an
          order. The negative margin lets it bleed to the card's own edge so the
          last tab is visibly cut off rather than looking like the last step. */}
      <div
        role="tablist"
        aria-label="Outreach steps"
        className="-mx-6 mt-4 flex gap-1 overflow-x-auto border-b border-line px-6"
      >
        {entries.map((entry) => (
          <StepTab
            key={entry.step}
            entry={entry}
            active={active?.step === entry.step}
            onSelect={() => setPicked(entry.step)}
          />
        ))}
      </div>

      {active ? (
        <StepPanel
          key={active.step}
          entry={active}
          note={notes[active.step]}
          setNote={(note) =>
            setNotes((prev) => ({ ...prev, [active.step]: note }))
          }
          actions={actions}
        />
      ) : (
        // Nothing is reachable at all, which is the state a lead sits in before
        // it has been enriched. The reasons are all in the list below, so this
        // says the one thing the list cannot.
        <p className="mt-4 text-xs leading-relaxed text-muted">
          No step is reachable yet. What each one is waiting for is below.
        </p>
      )}

      {locked.length > 0 && <WhatsNext entries={locked} />}
    </div>
  );
}

// ─── The stepper ───────────────────────────────────────────────────────────

// One tab: a status dot and a short name. The dot carries the state — a tick
// where the step has gone out, the step's own number where it is reachable, a
// padlock where it is not — so the row reads as progress rather than as five
// equal links.
function StepTab({
  entry,
  active,
  onSelect,
}: {
  entry: StepEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const locked = !entry.lock.unlocked;
  const label = OUTREACH_STEP_TAB_LABELS[entry.step];
  // A locked tab cannot be opened, so what would unlock it is the one thing it
  // can say — on hover, with the same sentence the list at the foot carries.
  const title = entry.lock.unlocked
    ? OUTREACH_STEP_LABELS[entry.step]
    : entry.lock.reason;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={locked}
      onClick={onSelect}
      title={title}
      className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        active
          ? "border-accent text-ink"
          : locked
            ? "cursor-default border-transparent text-muted/70"
            : "border-transparent text-muted hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`num flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] ${
          entry.sent
            ? "border-ok/30 bg-ok-soft text-ok"
            : active
              ? "border-accent/40 bg-accent/15 text-accent"
              : locked
                ? "border-transparent bg-transparent text-muted/70"
                : "border-line bg-wash text-muted"
        }`}
      >
        {entry.sent ? (
          <IconCheck size={11} stroke={2.5} />
        ) : locked ? (
          <IconLock size={11} stroke={1.75} />
        ) : (
          entry.index + 1
        )}
      </span>
      {label}
    </button>
  );
}

// The steps that are not reachable, one line each.
//
// These were full cards with a bordered reason box in each, stacked — four
// screens of things you cannot do. The reason is the only content a locked step
// has, so that is all this shows: a padlock, the step's name, and the sentence
// naming what would unlock it, stacked tight.
function WhatsNext({ entries }: { entries: StepEntry[] }) {
  return (
    <div className="mt-6">
      <p className="field-label mb-2">What's next</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li
            key={entry.step}
            className="flex items-start gap-2 rounded-[10px] border border-line/70 bg-wash/40 px-3 py-2"
          >
            <IconLock
              size={13}
              stroke={1.75}
              aria-hidden
              className="mt-0.5 shrink-0 text-muted"
            />
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-ink">
                {OUTREACH_STEP_LABELS[entry.step]}
              </span>
              {!entry.lock.unlocked && <> — {entry.lock.reason}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── One step ──────────────────────────────────────────────────────────────

function StepPanel({
  entry,
  note,
  setNote,
  actions,
}: {
  entry: StepEntry;
  note: StepNote | undefined;
  setNote: (note: StepNote) => void;
  actions: SequenceActions;
}) {
  const [running, setRunning] = useState(false);
  const { step, messages } = entry;

  async function run() {
    setRunning(true);
    try {
      const result = await actions.generate(step);
      if (!result.ok) {
        setNote({
          kind: "error",
          message: result.error,
          debug: result.debug ?? [],
        });
        return;
      }
      setNote(
        result.written === 0
          ? { kind: "none", basedOn: result.basedOn, debug: result.debug ?? [] }
          : {
              kind: "evidence",
              evidence: result.evidence ?? null,
              basedOn: result.basedOn,
              written: result.written,
              skipped: result.skipped ?? [],
              mechanism: result.mechanism ?? null,
              debug: result.debug ?? [],
            },
      );
    } catch {
      setNote({
        kind: "error",
        message:
          "The request could not be reached. Check the server is still up and try again.",
        debug: [],
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div role="tabpanel" className="pt-4">
      <p className="text-sm font-medium text-ink">
        {OUTREACH_STEP_LABELS[step]}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        {OUTREACH_STEP_BLURBS[step]}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <AiButton
          onClick={() => void run()}
          disabled={running}
          title="Writes from this lead's enrichment evidence and whatever has already been drafted. Nothing is sent."
          className="h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? "Writing…"
            : messages.length > 0
              ? "Regenerate"
              : step === "FIRST_MESSAGE"
                ? "Generate the openers"
                : "Generate"}
        </AiButton>
      </div>

      {note && <Note note={note} step={step} />}

      {/* One column, always. The three first-message options were a
          three-column grid until the column each one got was narrow
          enough to break its label over four lines and show four words
          of the message — a choice between three things you cannot read
          is not a choice. Stacked, each option is full width, and the
          labels above them are what makes the list scannable. */}
      {messages.length > 0 && (
        <div className="mt-3 space-y-3">
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── The collapsed aside ───────────────────────────────────────────────────

// Anything about a draft that is not the draft: the evidence it was read off,
// the trace of what ran. Closed by default and quiet when open, because the
// thing on this page somebody is about to paste into a stranger's inbox is the
// message, and a bordered block of reasoning under it competes with the message
// for the eye every time the page loads.
function Aside({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group/aside mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium tracking-[0.02em] text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <IconChevronRight
          size={12}
          stroke={2}
          aria-hidden
          className="shrink-0 transition-transform group-open/aside:rotate-90"
        />
        {summary}
      </summary>
      <div className="mt-1.5 pl-[13px] text-xs leading-relaxed text-muted">
        {children}
      </div>
    </details>
  );
}

// What the last run had to say, where that is worth saying. Three shapes, and
// the middle one is the interesting one: the evidence was not specific enough
// to write something credible, which is a real answer rather than a failure.
function Note({ note, step }: { note: StepNote; step: OutreachStep }) {
  if (note.kind === "error") {
    return (
      <div className="mt-2.5 rounded-[10px] border border-bad/30 bg-bad-soft/60 px-4 py-3">
        <p className="text-sm font-medium text-bad">Nothing was written</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {note.message}
        </p>
        <DebugTrace lines={note.debug} />
      </div>
    );
  }
  if (note.kind === "none") {
    return (
      <div className="mt-2.5 rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
        <p className="text-sm font-medium text-ink">
          Nothing specific enough to say
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          The evidence gathered for this clinic
          {note.basedOn.length > 0 && (
            <> — {note.basedOn.join(", ").toLowerCase()} — </>
          )}
          carries nothing concrete enough to build{" "}
          {step === "FIRST_MESSAGE"
            ? "an opener"
            : step === "FOLLOW_UP"
              ? "a second, different observation"
              : "a message"}{" "}
          on, so nothing
          was written rather than something that would read as a template.
          Crawling more of the site, or a look at it by hand, is what would
          change that.
        </p>
        <DebugTrace lines={note.debug} />
      </div>
    );
  }
  // The curiosity fallback: one message, and not one of the three that were
  // asked for. Said first and said plainly, because the difference between "here
  // are your openers" and "the evidence would not carry an observation, so here
  // is a question instead" is the thing somebody needs to know before they paste
  // it, and it is not visible in the wording of the message itself.
  const curiosity =
    note.mechanism === "curiosity_process" ||
    note.mechanism === "curiosity_pain_signal";
  if (curiosity) {
    return (
      <div className="mt-2.5 rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
        <p className="text-sm font-medium text-ink">
          A curiosity opener, not an observation
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Nothing in the evidence
          {note.basedOn.length > 0 && (
            <> — {note.basedOn.join(", ").toLowerCase()} — </>
          )}
          would carry a verified pain observation, so none of the three openers
          was written. This asks{" "}
          {note.mechanism === "curiosity_process"
            ? "how follow-up after a first visit is handled, and presumes nothing is wrong with it"
            : "how a no-show gets caught, on the back of a soft signal in the evidence pointing that way"}
          . It names no problem and describes no service, so it is sendable as it
          stands, but it is a different bet than an observation: the app records
          which one it was so the reply rates can be compared later.
        </p>
        {note.evidence && (
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Read off: “{note.evidence}”
          </p>
        )}
        <DebugTrace lines={note.debug} />
      </div>
    );
  }
  // The step 2 bump, said the same way and for the same reason: this message
  // makes no new observation on purpose, and without that said it reads as a
  // thin follow-up rather than a deliberate one. Same card as the curiosity
  // note above, because it is the same kind of thing — the branch that ran was
  // not the branch the step usually runs.
  if (note.mechanism === "step2_bump") {
    return (
      <div className="mt-2.5 rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
        <p className="text-sm font-medium text-ink">
          A bump, not a new observation
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          The first message went out and was never answered, so there is no
          reply to build a second angle on. This restates what was already sent
          in one line and gives them an easy way to end it. It adds no new
          observation, no pitch and nothing about the audit, which is what makes
          it sendable: the short version is checked against the message that
          actually went out before it is written, so it cannot quietly become a
          second opener.
        </p>
        {note.evidence && (
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Condensed from: “{note.evidence}”
          </p>
        )}
        <DebugTrace lines={note.debug} />
      </div>
    );
  }
  const short = step === "FIRST_MESSAGE" && note.written < 3;
  if (!note.evidence && note.basedOn.length === 0 && !short) return null;
  return (
    <div className="mt-2.5 text-xs leading-relaxed text-muted">
      {/* The shortfall is the one part of this that is not reasoning — it says
          you got fewer options than you asked for, which is a fact about what is
          on screen — so it stays out in the open while the evidence folds away. */}
      {short && (
        <p className="text-warn">
          {note.written === 1 ? "One option" : `${note.written} options`} rather
          than three
          {note.skipped.length > 0 && (
            <>
              {" "}
              — nothing in the evidence supports{" "}
              {note.skipped
                .map((v) => `option ${v}`)
                .join(" or ")}
              , so {note.skipped.length === 1 ? "it was" : "they were"} left out
              rather than invented
            </>
          )}
          .
        </p>
      )}
      {(note.evidence || note.basedOn.length > 0) && (
        <Aside summary="What this was written from">
          {note.evidence && <p>Read off: “{note.evidence}”</p>}
          {note.basedOn.length > 0 && (
            <p>Written from {note.basedOn.join(", ").toLowerCase()}.</p>
          )}
        </Aside>
      )}
      <DebugTrace lines={note.debug} />
    </div>
  );
}

// TEMPORARY. What the step actually did, in the order it did it, as the server
// logged it. It is a debugging aid rather than part of the panel: folded away,
// monospaced, muted, and rendered only when a trace came back, so removing the
// debug field from the action removes this from the page without another edit.
// Nothing in a line is message text, so there is nothing here to paste by
// accident.
function DebugTrace({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Aside summary="Debug trace — temporary, also in the server log as [outreach:step2]">
      <ol className="space-y-0.5">
        {lines.map((line, i) => (
          <li key={i} className="num text-[11px] leading-relaxed text-muted">
            {i + 1}. {line}
          </li>
        ))}
      </ol>
    </Aside>
  );
}

// ─── One drafted message ───────────────────────────────────────────────────

function MessageCard({
  message,
  actions,
}: {
  message: OutreachMessageView;
  actions: SequenceActions;
}) {
  // The text as it stands in the box, which is the thing that actually gets
  // copied. Seeded from the row and then owned by whoever is typing in it;
  // Save writes it back, because unlike the old hook panel the message *is* the
  // stored thing and an edit lost on reload would be lost work.
  const [text, setText] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edited = text.trim() !== message.content.trim();
  const sent = message.sentAt !== null;
  // The opener type is only a question on the first message: every other step
  // has one mechanism by construction, and the follow-up's branches are stamped
  // by the step that writes them.
  const tagsOpener = message.step === "FIRST_MESSAGE";
  const untagged =
    tagsOpener &&
    message.messageMechanism !== "observation" &&
    message.messageMechanism !== "curiosity_process" &&
    message.messageMechanism !== "curiosity_pain_signal";
  // Which bracketed blank, if any, the draft still carries. A lead with no
  // contact name leaves the first-name one; a credentialed contact recorded
  // without a surname leaves the surname one, because "Hi Dr." is not a
  // greeting. Either way the fix is the same: type the name into the lead.
  const nameBlank = text.includes(CONTACT_NAME_PLACEHOLDER)
    ? CONTACT_NAME_PLACEHOLDER
    : text.includes(CONTACT_LAST_NAME_PLACEHOLDER)
      ? CONTACT_LAST_NAME_PLACEHOLDER
      : null;
  const isConnection = message.step === "CONNECTION";
  const overLength = isConnection && text.length > CONNECTION_MAX_CHARS;
  // Only the first message is held to it, and only once there is something to
  // hold — an empty box is not a message that failed the rule.
  const needsQuestion =
    message.step === "FIRST_MESSAGE" &&
    text.trim() !== "" &&
    !endsInQuestion(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused — an insecure origin, a browser
      // setting. The text is on screen and selectable either way, so this says
      // so rather than failing silently.
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <div
      className={`rounded-[10px] border p-4 ${
        sent ? "border-ok/30 bg-ok-soft/30" : "border-line bg-wash/50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-xs font-medium">
          {message.variant ? (
            <>
              <span className="inline-flex h-[18px] items-center rounded-[6px] bg-accent/10 px-1.5 text-accent">
                Option {message.variant}
              </span>
              <span className="ml-2 font-normal text-muted">
                {VARIANT_BLURBS[message.variant as FirstMessageVariant] ?? ""}
              </span>
            </>
          ) : (
            OUTREACH_STEP_LABELS[message.step]
          )}
          {/* Only where it is not the sequence's usual mechanism. Labelling
              every observation-led message "Observation-led" would be labelling
              the whole panel, and the label exists to mark the exception. */}
          {message.messageMechanism !== null &&
            message.messageMechanism !== "observation" && (
              <span className="ml-2 inline-flex h-[18px] items-center rounded-[6px] bg-warn-soft px-1.5 font-normal text-warn">
                {MESSAGE_MECHANISM_LABELS[message.messageMechanism]}
              </span>
            )}
        </p>
        <p
          className={`num shrink-0 text-xs ${overLength ? "text-bad" : "text-muted"}`}
          title={
            isConnection
              ? `LinkedIn caps a connection note at ${CONNECTION_MAX_CHARS} characters`
              : undefined
          }
        >
          {text.length}
          {isConnection ? ` / ${CONNECTION_MAX_CHARS}` : ""} characters
        </p>
      </div>

      <textarea
        // Unnamed on purpose — see the note at the top of this file.
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCopied(false);
        }}
        rows={message.variant ? 6 : 4}
        aria-label={`${OUTREACH_STEP_LABELS[message.step]}${
          message.variant ? ` option ${message.variant}` : ""
        } — the message to copy`}
        className={`field mt-2 text-sm ${
          overLength ? "border-bad focus:border-bad focus:ring-bad/15" : ""
        }`}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={text.trim() === ""}
          className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>

        {edited && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => actions.saveContent(message.id, text))
            }
            className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save edit"}
          </button>
        )}

        {sent ? (
          <span className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-ok/30 bg-ok-soft/60 pl-3 pr-1.5 text-xs font-medium text-ok">
            <span className="num">✓ Sent</span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => actions.clearSent(message.id))
              }
              title="Clear this mark — nothing on LinkedIn changes"
              className="rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              {pending ? "…" : "Undo"}
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending || untagged}
            onClick={() =>
              startTransition(async () =>
                setMarkError(await actions.markSent(message.id)),
              )
            }
            title={
              untagged
                ? "Pick the opener type first — it cannot be worked out later"
                : "Records that you pasted this into LinkedIn yourself"
            }
            className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Marking…" : "Mark sent"}
          </button>
        )}
      </div>

      {/* Which kind of opener this is, editable, and asked for before the mark
          rather than after: the answer is free while somebody still remembers
          writing it and unrecoverable a week later. A full-height select on its
          own row, because .field fixes its own height and one sitting in the
          34px button row above would sit a few pixels off everything in it. */}
      {tagsOpener && (
        <div className="mt-2.5">
          <MechanismPicker
            value={message.messageMechanism}
            set={(mechanism) => actions.setMechanism(message.id, mechanism)}
            hint="Needed before this can be marked sent."
          />
        </div>
      )}

      {markError && (
        <p className="mt-2 text-xs leading-relaxed text-bad">{markError}</p>
      )}

      {/* Why the message reads the way it does — the evidence behind it and what
          it deliberately does not claim. Folded away: it is longer than the
          message it explains, and it is read once, when the message surprises
          you, not every time the page opens. */}
      {message.internalNote && (
        <Aside summary="Why this was written this way">
          <p className="whitespace-pre-line">{message.internalNote}</p>
        </Aside>
      )}

      {(nameBlank !== null || copyFailed || edited || needsQuestion) && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {nameBlank !== null &&
            `Fill in ${nameBlank} — this lead has no contact name on it. `}
          {/* Reported rather than enforced: this used to be a rule that threw
              the whole option away, which cost a choice of three its third. */}
          {needsQuestion &&
            "This one does not end in a question — an opener that lands on a full stop gives them nothing to answer. "}
          {copyFailed &&
            "This browser would not let the page write to the clipboard; select the text and copy it by hand. "}
          {edited && "Edited — Save edit keeps it, a reload loses it."}
        </p>
      )}
    </div>
  );
}

// ─── The two state marks ───────────────────────────────────────────────────

// The same control ConnectionRequestToggle is, in the same two states: a button
// until the thing has happened, then the date with a way back from it. A button
// rather than a form, because this sits inside the lead's details form and the
// browser drops a nested one.
function MarkToggle({
  label,
  idle,
  title,
  mark,
  clear,
}: {
  label: string | null;
  idle: string;
  title: string;
  mark: () => Promise<void>;
  clear: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  if (label !== null) {
    return (
      <span className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-ok/30 bg-ok-soft/60 pl-3 pr-1.5 text-xs font-medium text-ok">
        <span className="num">✓ {label}</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => clear())}
          title="Clear this mark — nothing on LinkedIn changes"
          className="rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
        >
          {pending ? "…" : "Undo"}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      title={title}
      onClick={() => startTransition(async () => mark())}
      className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Marking…" : idle}
    </button>
  );
}
