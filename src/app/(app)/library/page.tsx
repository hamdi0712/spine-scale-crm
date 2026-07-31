import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { prisma } from "@/lib/prisma";
import {
  createLibraryEntry,
  deleteLibraryEntry,
  updateLibraryEntry,
} from "@/lib/actions/library";
import {
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABELS,
  LibraryCategory,
} from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { category?: string; entry?: string; edit?: string; new?: string };
}) {
  const category: LibraryCategory = LIBRARY_CATEGORIES.includes(
    searchParams.category as LibraryCategory
  )
    ? (searchParams.category as LibraryCategory)
    : LIBRARY_CATEGORIES[0];

  const [entries, counts] = await Promise.all([
    prisma.libraryEntry.findMany({
      where: { category },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.libraryEntry.groupBy({ by: ["category"], _count: true }),
  ]);

  const countFor = (c: string) =>
    counts.find((x) => x.category === c)?._count ?? 0;

  const selected = searchParams.entry
    ? entries.find((e) => e.id === searchParams.entry) ?? null
    : null;
  const editing = selected && searchParams.edit === "1";
  const creating = searchParams.new === "1";

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Library</h1>
      <p className="mt-0.5 text-sm text-muted">
        Playbooks and templates, written as you build them
      </p>

      <div className="card mt-6 grid items-stretch divide-y divide-line lg:grid-cols-[12rem_16rem_1fr] lg:divide-x lg:divide-y-0">
        {/* Categories */}
        <nav className="self-stretch py-1">
          {LIBRARY_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/library?category=${c}`}
              className={`mx-1.5 my-0.5 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                c === category
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:bg-bg hover:text-ink"
              }`}
            >
              <span>{LIBRARY_CATEGORY_LABELS[c]}</span>
              <span className="font-mono text-[11px] text-muted">
                {countFor(c)}
              </span>
            </Link>
          ))}
        </nav>

        {/* Entry list */}
        <div className="flex min-h-[24rem] flex-col self-stretch">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Entries
            </span>
            <Link
              href={`/library?category=${category}&new=1`}
              className="text-sm font-medium text-accent hover:underline"
            >
              + New
            </Link>
          </div>
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted">
              Nothing here yet — this category fills up as you write real
              material.
            </p>
          ) : (
            <ul className="flex-1">
              {entries.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/library?category=${category}&entry=${e.id}`}
                    className={`block border-b border-line px-3 py-2 ${
                      selected?.id === e.id ? "bg-bg" : "hover:bg-bg"
                    }`}
                  >
                    <div
                      className={`truncate text-sm ${
                        selected?.id === e.id ? "font-medium text-ink" : ""
                      }`}
                    >
                      {e.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted">
                      {fmtDate(e.updatedAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Viewer / editor */}
        <div className="min-h-[24rem] self-stretch p-5">
          {creating ? (
            <form action={createLibraryEntry} className="flex h-full flex-col gap-3">
              <input type="hidden" name="category" value={category} />
              <div>
                <label className="field-label" htmlFor="title">
                  Title
                </label>
                <input id="title" name="title" required className="field" />
              </div>
              <div className="flex flex-1 flex-col">
                <label className="field-label" htmlFor="body">
                  Content (markdown)
                </label>
                <textarea
                  id="body"
                  name="body"
                  rows={16}
                  className="field flex-1 font-mono text-[13px]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Link href={`/library?category=${category}`} className="btn">
                  Cancel
                </Link>
                <button type="submit" className="btn-primary">
                  Save entry
                </button>
              </div>
            </form>
          ) : editing && selected ? (
            <form
              action={updateLibraryEntry.bind(null, selected.id)}
              className="flex h-full flex-col gap-3"
            >
              <div>
                <label className="field-label" htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  name="title"
                  defaultValue={selected.title}
                  required
                  className="field"
                />
              </div>
              <div className="flex flex-1 flex-col">
                <label className="field-label" htmlFor="body">
                  Content (markdown)
                </label>
                <textarea
                  id="body"
                  name="body"
                  rows={16}
                  defaultValue={selected.body}
                  className="field flex-1 font-mono text-[13px]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Link
                  href={`/library?category=${category}&entry=${selected.id}`}
                  className="btn"
                >
                  Cancel
                </Link>
                <button type="submit" className="btn-primary">
                  Save changes
                </button>
              </div>
            </form>
          ) : selected ? (
            <div>
              <div className="flex items-start justify-between border-b border-line pb-3">
                <div>
                  <h2 className="text-base font-semibold">{selected.title}</h2>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">
                    Updated {fmtDate(selected.updatedAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/library?category=${category}&entry=${selected.id}&edit=1`}
                    className="btn"
                  >
                    Edit
                  </Link>
                  <ConfirmForm
                    action={deleteLibraryEntry.bind(null, selected.id)}
                    message={`Delete "${selected.title}"?`}
                    className="btn-danger"
                  >
                    Delete
                  </ConfirmForm>
                </div>
              </div>
              <div className="prose-doc mt-4">
                {selected.body.trim() === "" ? (
                  <p className="text-muted">This entry has no content yet.</p>
                ) : (
                  <ReactMarkdown>{selected.body}</ReactMarkdown>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Select an entry, or create one with “+ New”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
