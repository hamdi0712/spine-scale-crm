import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { prisma } from "@/lib/prisma";
import {
  createResearchNote,
  deleteResearchNote,
  updateResearchNote,
} from "@/lib/actions/adhub";
import {
  RESEARCH_NOTE_TYPES,
  RESEARCH_NOTE_TYPE_BLURBS,
  RESEARCH_NOTE_TYPE_LABELS,
  ResearchNoteType,
} from "@/lib/adhub";
import { fmtDate } from "@/lib/format";
import AdHubNav from "@/components/AdHubNav";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

const ALL = "ALL";

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: { type?: string; note?: string; edit?: string; new?: string };
}) {
  // Research is read across types as often as within one, so unlike the
  // Library's fixed categories this filter starts on everything.
  const type: string = RESEARCH_NOTE_TYPES.includes(
    searchParams.type as ResearchNoteType,
  )
    ? (searchParams.type as ResearchNoteType)
    : ALL;

  const [notes, counts, total] = await Promise.all([
    prisma.researchNote.findMany({
      where: type === ALL ? {} : { type },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.researchNote.groupBy({ by: ["type"], _count: true }),
    prisma.researchNote.count(),
  ]);

  const countFor = (t: string) =>
    t === ALL ? total : (counts.find((x) => x.type === t)?._count ?? 0);

  const selected = searchParams.note
    ? (notes.find((n) => n.id === searchParams.note) ?? null)
    : null;
  const editing = selected && searchParams.edit === "1";
  const creating = searchParams.new === "1";
  const listHref = `/ad-hub/research?type=${type}`;

  return (
    <div>
      <AdHubNav
        current="research"
        blurb="Raw research, before it is shaped into a persona or a concept"
        action={
          <Link href={`${listHref}&new=1`} className="btn-primary">
            New note
          </Link>
        }
      />

      <div className="card mt-8 grid items-stretch divide-y divide-line lg:grid-cols-[13rem_16rem_1fr] lg:divide-x lg:divide-y-0">
        {/* Types */}
        <nav className="self-stretch py-1">
          {[ALL, ...RESEARCH_NOTE_TYPES].map((t) => (
            <Link
              key={t}
              href={`/ad-hub/research?type=${t}`}
              className={`mx-1.5 my-0.5 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                t === type
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:bg-wash/70 hover:text-ink"
              }`}
            >
              <span>
                {t === ALL
                  ? "All types"
                  : RESEARCH_NOTE_TYPE_LABELS[t as ResearchNoteType]}
              </span>
              <span className="num text-xs text-muted">{countFor(t)}</span>
            </Link>
          ))}
          {type !== ALL && (
            <p className="mx-1.5 mt-2 px-3 pb-2 text-xs leading-relaxed text-muted">
              {RESEARCH_NOTE_TYPE_BLURBS[type as ResearchNoteType]}
            </p>
          )}
        </nav>

        {/* Note list */}
        <div className="flex min-h-[24rem] flex-col self-stretch">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
            <span className="text-xs font-medium tracking-[0.02em] text-muted">
              Notes
            </span>
            <Link
              href={`${listHref}&new=1`}
              className="text-sm font-medium text-accent hover:underline"
            >
              + New
            </Link>
          </div>
          {notes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              Nothing here yet — research fills this up before any of it becomes
              a persona or a concept.
            </p>
          ) : (
            <ul className="flex-1">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`${listHref}&note=${n.id}`}
                    className={`block border-b border-line/60 px-4 py-3 ${
                      selected?.id === n.id ? "bg-wash/70" : "hover:bg-wash/70"
                    }`}
                  >
                    <div
                      className={`truncate text-sm ${
                        selected?.id === n.id ? "font-medium text-ink" : ""
                      }`}
                    >
                      {n.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span>
                        {RESEARCH_NOTE_TYPE_LABELS[n.type as ResearchNoteType] ??
                          n.type}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="num">{fmtDate(n.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Viewer / editor */}
        <div className="min-h-[24rem] self-stretch p-6">
          {creating ? (
            <NoteForm
              action={createResearchNote}
              defaultType={type === ALL ? RESEARCH_NOTE_TYPES[0] : type}
              cancelHref={listHref}
              submitLabel="Save note"
            />
          ) : editing && selected ? (
            <NoteForm
              action={updateResearchNote.bind(null, selected.id)}
              defaultType={selected.type}
              defaultTitle={selected.title}
              defaultBody={selected.body}
              cancelHref={`${listHref}&note=${selected.id}`}
              submitLabel="Save changes"
            />
          ) : selected ? (
            <div>
              <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
                <div className="min-w-0">
                  <h2 className="display text-base font-semibold">{selected.title}</h2>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span>
                      {RESEARCH_NOTE_TYPE_LABELS[
                        selected.type as ResearchNoteType
                      ] ?? selected.type}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="num">
                      Created {fmtDate(selected.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`${listHref}&note=${selected.id}&edit=1`}
                    className="btn"
                  >
                    Edit
                  </Link>
                  <ConfirmForm
                    action={deleteResearchNote.bind(null, selected.id)}
                    message={`Delete "${selected.title}"?`}
                    className="btn-danger"
                  >
                    Delete
                  </ConfirmForm>
                </div>
              </div>
              <div className="prose-doc mt-4">
                {selected.body.trim() === "" ? (
                  <p className="text-muted">This note has no content yet.</p>
                ) : (
                  <ReactMarkdown>{selected.body}</ReactMarkdown>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Select a note, or create one with &ldquo;+ New&rdquo;.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteForm({
  action,
  defaultType,
  defaultTitle,
  defaultBody,
  cancelHref,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  defaultType: string;
  defaultTitle?: string;
  defaultBody?: string;
  cancelHref: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="flex h-full flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="field-label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            name="title"
            defaultValue={defaultTitle}
            required
            className="field"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={defaultType}
            className="field"
          >
            {RESEARCH_NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RESEARCH_NOTE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <label className="field-label" htmlFor="body">
          Note (markdown)
        </label>
        <textarea
          id="body"
          name="body"
          rows={16}
          defaultValue={defaultBody}
          className="field flex-1 font-mono text-[13px]"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Link href={cancelHref} className="btn">
          Cancel
        </Link>
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
