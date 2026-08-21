import BusinessContextForm from "@/components/BusinessContextForm";
import { saveBusinessContextAction } from "@/lib/actions/businessContext";
import { loadBusinessContext } from "@/lib/businessContextStore";

export const dynamic = "force-dynamic";

// Business context — the standing description of this agency, given to the AI
// Copilot at the head of every conversation.
//
// The copilot can already read every record in the app. What it cannot read is
// the business those records belong to: how the money works, who is worth
// talking to and who is not, how this agency sounds, and the things it must
// never say. That is what this page is for, and it is prose rather than fields
// because none of it is a column anybody could have designed in advance.
//
// It is the one text in the app that reaches a model as instruction rather than
// as data — which is exactly what a scraped clinic website is not. The panel
// below says so plainly, because "the copilot will follow this" is the whole
// point of the page and worth knowing before typing in it.
export default async function BusinessContextPage() {
  const state = await loadBusinessContext();

  return (
    <div>
      <div className="mb-4">
        <h2 className="display text-xl font-semibold">Business context</h2>
        <p className="mt-1 text-sm text-muted">
          What the AI Copilot should know about your business before it answers
          anything
        </p>
      </div>

      <div className="card mb-6 px-6 py-4">
        <p className="text-sm font-medium">How this is used</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Whatever is saved here is put at the top of the copilot&rsquo;s
          instructions on every conversation, before it looks anything up. It is
          treated as your own standing instruction — it shapes how answers are
          written and which rules are followed, so a compliance line typed here
          applies to every reply. It is not sent anywhere else, and it changes
          nothing about what the copilot can see: it still reads your records
          through the same read-only lookups and still cannot edit anything.
          Leave the page empty and the copilot runs exactly as it did before.
        </p>
      </div>

      <BusinessContextForm state={state} save={saveBusinessContextAction} />
    </div>
  );
}
