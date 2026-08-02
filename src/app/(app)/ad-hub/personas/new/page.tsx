import Link from "next/link";
import { createPersona } from "@/lib/actions/adhub";
import { PERSONA_FIELDS } from "@/lib/adhub";

export default function NewPersonaPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/ad-hub" className="text-sm text-accent hover:underline">
          ← Ad Hub
        </Link>
        <h1 className="display mt-2 text-[32px] font-semibold">
          New persona
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Who the ads talk to. The last two prompts matter most — what they
          already tried, and why it failed them.
        </p>
      </div>
      <form action={createPersona} className="card space-y-5 p-6">
        <div>
          <label className="field-label" htmlFor="name">
            Persona name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Desk-bound Dave, 45, still lifting"
            className="field"
          />
        </div>
        {PERSONA_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="field-label" htmlFor={f.key}>
              {f.label}
            </label>
            <textarea
              id={f.key}
              name={f.key}
              rows={2}
              placeholder={f.placeholder}
              className="field"
            />
          </div>
        ))}
        <div className="flex justify-end gap-3 border-t border-line/60 pt-5">
          <Link href="/ad-hub" className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn-primary">
            Create persona
          </button>
        </div>
      </form>
    </div>
  );
}
