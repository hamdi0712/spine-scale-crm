"use client";

// A list of short tags: a field with a + beside it, and the tags already added
// as removable chips underneath.
//
// Each chip posts one hidden input under the list's name, so the server reads
// the whole list with formData.getAll(name) — the same shape a set of checkboxes
// posts, and nothing to parse. Tags are normalised here exactly as the server
// normalises them (normalizeTag in src/lib/icpDefinition.ts), so the chip on
// screen is the tag that will be stored: "Spinal Decompression " becomes
// "spinal decompression", and adding it a second time does nothing.
//
// Enter adds, like the + does, rather than submitting the form around it — a
// half-typed tag should never save the page.

import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { ICP_TAGS_MAX, normalizeTag } from "@/lib/icpDefinition";

export default function TagInput({
  id,
  name,
  label,
  hint,
  placeholder,
  initial,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
  initial: string[];
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");

  const pending = normalizeTag(draft);
  const duplicate = pending !== "" && tags.includes(pending);
  const full = tags.length >= ICP_TAGS_MAX;

  function add() {
    if (pending === "" || duplicate || full) return;
    setTags((prev) => [...prev, pending]);
    setDraft("");
  }

  function remove(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="field min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending === "" || duplicate || full}
          aria-label={`Add to ${label.toLowerCase()}`}
          className="btn shrink-0 px-3.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconPlus size={16} stroke={1.75} aria-hidden />
        </button>
      </div>
      {duplicate && (
        <p className="mt-1.5 text-xs text-muted">Already in the list.</p>
      )}
      {hint && !duplicate && (
        <p className="helper-text mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>
      )}

      {tags.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={label}>
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex h-[30px] max-w-full items-center gap-1 rounded-full border border-line bg-wash/60 pl-3 pr-1 text-sm text-ink-soft"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-muted hover:bg-line/70 hover:text-ink"
              >
                <IconX size={14} stroke={1.75} aria-hidden />
              </button>
              <input type="hidden" name={name} value={tag} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-xs text-muted">None yet.</p>
      )}
    </div>
  );
}
