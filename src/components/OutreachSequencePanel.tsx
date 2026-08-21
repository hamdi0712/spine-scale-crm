"use client";

// The outreach sequence — five steps down the page, in the order they happen.
//
// It replaces the single "Generate outreach hook" button that used to sit in
// the outreach row. That button drafted one line; this drafts the whole
// sequence, one step at a time, and each step waits for the thing that has to
// happen before it makes sense: a request accepted, a reply, a Loom recorded, a
// follow-up date come round.
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
import { IconCheck, IconLock } from "@tabler/icons-react";
import {
  CONTACT_NAME_PLACEHOLDER,
  CONNECTION_MAX_CHARS,
  OUTREACH_STEPS,
  OUTREACH_STEP_BLURBS,
  OUTREACH_STEP_LABELS,
  OutreachStep,
  SequenceState,
  VARIANT_BLURBS,
  FirstMessageVariant,
  endsInQuestion,
  stepLock,
  stepUsesModel,
} from "@/lib/outreachSequence";
import {
  OutreachMessageView,
  OutreachStepResult,
  currentMessages,
} from "@/lib/outreachSequenceRead";
import AiButton from "@/components/AiButton";

export interface SequenceActions {
  generate: (step: string) => Promise<OutreachStepResult>;
  markSent: (messageId: string) => Promise<void>;
  clearSent: (messageId: string) => Promise<void>;
  saveContent: (messageId: string, content: string) => Promise<void>;
  markAccepted: () => Promise<void>;
  clearAccepted: () => Promise<void>;
  markReplied: () => Promise<void>;
  clearReplied: () => Promise<void>;
}

// What a step is saying about its last run, held per step so generating step 3
// does not clear the note under step 1.
type StepNote =
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
    };

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
  // Worth stating up here: "Hi Dr. Mike" is the kind of thing you want to have
  // agreed with before it is pasted into a stranger's inbox, not to discover in
  // the message. Editing the box still overrides it either way.
  salutationNote: string;
}) {
  const [notes, setNotes] = useState<Partial<Record<OutreachStep, StepNote>>>(
    {},
  );

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

      <ol className="mt-4">
        {OUTREACH_STEPS.map((step, i) => (
          <StepRow
            key={step}
            step={step}
            index={i}
            last={i === OUTREACH_STEPS.length - 1}
            lock={stepLock(step, state)}
            messages={currentMessages(messages, step)}
            note={notes[step]}
            setNote={(note) => setNotes((prev) => ({ ...prev, [step]: note }))}
            actions={actions}
          />
        ))}
      </ol>
    </div>
  );
}

// ─── One step ──────────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  last,
  lock,
  messages,
  note,
  setNote,
  actions,
}: {
  step: OutreachStep;
  index: number;
  last: boolean;
  lock: ReturnType<typeof stepLock>;
  messages: OutreachMessageView[];
  note: StepNote | undefined;
  setNote: (note: StepNote) => void;
  actions: SequenceActions;
}) {
  const [running, setRunning] = useState(false);
  const locked = !lock.unlocked;
  const sent = messages.some((m) => m.sentAt !== null);

  async function run() {
    setRunning(true);
    try {
      const result = await actions.generate(step);
      if (!result.ok) {
        setNote({ kind: "error", message: result.error });
        return;
      }
      setNote(
        result.written === 0
          ? { kind: "none", basedOn: result.basedOn }
          : {
              kind: "evidence",
              evidence: result.evidence ?? null,
              basedOn: result.basedOn,
              written: result.written,
              skipped: result.skipped ?? [],
            },
      );
    } catch {
      setNote({
        kind: "error",
        message:
          "The request could not be reached. Check the server is still up and try again.",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {/* The spine of the timeline: a numbered disc per step, joined by a rule
          that stops at the last one. A sent step's disc is the ok green the
          rest of the app marks a done thing in. */}
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={`num flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${
            sent
              ? "border-ok/30 bg-ok-soft text-ok"
              : locked
                ? "border-line bg-wash text-muted"
                : "border-accent/30 bg-accent/10 text-accent"
          }`}
        >
          {sent ? <IconCheck size={14} stroke={2} aria-hidden /> : index + 1}
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-line" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p
            className={`text-sm font-medium ${locked ? "text-muted" : "text-ink"}`}
          >
            {OUTREACH_STEP_LABELS[step]}
          </p>
          {!stepUsesModel(step) && !locked && (
            <p className="text-xs text-muted">Filled from the template</p>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {OUTREACH_STEP_BLURBS[step]}
        </p>

        {locked ? (
          <div className="mt-2.5 flex items-start gap-2 rounded-[10px] border border-line bg-wash/40 px-3.5 py-2.5">
            <IconLock
              size={14}
              stroke={1.75}
              aria-hidden
              className="mt-0.5 shrink-0 text-muted"
            />
            <p className="text-xs leading-relaxed text-muted">{lock.reason}</p>
          </div>
        ) : (
          <>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {stepUsesModel(step) ? (
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
                        ? "Generate three openers"
                        : "Generate"}
                </AiButton>
              ) : (
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={running}
                  className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {running
                    ? "Filling…"
                    : messages.length > 0
                      ? "Rebuild from template"
                      : "Fill from template"}
                </button>
              )}
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
                  <MessageCard
                    key={message.id}
                    message={message}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </li>
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
          {step === "FIRST_MESSAGE" ? "an opener" : "a message"} on, so nothing
          was written rather than something that would read as a template.
          Crawling more of the site, or a look at it by hand, is what would
          change that.
        </p>
      </div>
    );
  }
  const short = step === "FIRST_MESSAGE" && note.written < 3;
  if (!note.evidence && note.basedOn.length === 0 && !short) return null;
  return (
    <div className="mt-2.5 text-xs leading-relaxed text-muted">
      {note.evidence && <p>Read off: “{note.evidence}”</p>}
      {note.basedOn.length > 0 && (
        <p>Written from {note.basedOn.join(", ").toLowerCase()}.</p>
      )}
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
    </div>
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
  const [pending, startTransition] = useTransition();

  const edited = text.trim() !== message.content.trim();
  const sent = message.sentAt !== null;
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
            disabled={pending}
            onClick={() =>
              startTransition(async () => actions.markSent(message.id))
            }
            title="Records that you pasted this into LinkedIn yourself"
            className="btn h-[34px] px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Marking…" : "Mark sent"}
          </button>
        )}
      </div>

      {message.internalNote && (
        <div className="mt-2.5 rounded-[8px] border border-line/70 bg-surface/60 px-3 py-2">
          <p className="text-[11px] font-medium tracking-[0.02em] text-muted">
            Internal note — not part of the message
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted">
            {message.internalNote}
          </p>
        </div>
      )}

      {(text.includes(CONTACT_NAME_PLACEHOLDER) ||
        copyFailed ||
        edited ||
        needsQuestion) && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {text.includes(CONTACT_NAME_PLACEHOLDER) &&
            `Fill in ${CONTACT_NAME_PLACEHOLDER} — this lead has no contact name on it. `}
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
