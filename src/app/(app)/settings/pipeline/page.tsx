import { savePipelineSettings } from "@/lib/actions/pipelineSettings";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { isDefaultPipelineSettings } from "@/lib/pipelineSettings";
import PipelineSettingsForm from "@/components/PipelineSettingsForm";

export const dynamic = "force-dynamic";

// Pipeline — the one page in the app that changes how the chain runs rather
// than what is in it: which enrichment steps Discovery spends money on, the
// actors behind them, and the score a candidate has to clear to become a lead.
// Everything on it was a constant in the source until this page existed.
//
// It used to be /pipeline/settings, sat under Pipeline because that is what it
// decides the entrance to, and had its own item in the sidebar. It is a setting
// and it lives with the settings now; the old path redirects here. The page
// title and the "back to" link are gone because the layout above supplies both.
export default async function PipelineSettingsPage() {
  const settings = await loadPipelineSettings();

  return (
    <div>
      <div className="mb-4">
        <h2 className="display text-xl font-semibold">Pipeline</h2>
        <p className="mt-1 text-sm text-muted">
          Which enrichment steps run, the actors behind them, and the score a
          candidate has to reach to become a lead
        </p>
      </div>

      {/* The honest limit of what this page can promise, said before anything
          on it is touched rather than discovered afterwards. */}
      <div className="card mb-8 px-6 py-4">
        <p className="text-sm font-medium">What a swap can and cannot do</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Each step sends an input built for its actor and reads named fields
          back out. A replacement actor that takes the same input and names its
          output the same way drops straight in; one that names things
          differently will run, cost money, and read as “nothing found”. The
          inputs and the field names it looks for are in{" "}
          <code className="rounded bg-wash/70 px-1 py-0.5 font-mono text-[11px]">
            src/lib/leadEnrich.ts
          </code>
          , which is the one part of a step that is still code.
        </p>
        {isDefaultPipelineSettings(settings) && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Nothing here has been changed — every step is on and running the
            actor this app ships with.
          </p>
        )}
      </div>

      <PipelineSettingsForm settings={settings} save={savePipelineSettings} />
    </div>
  );
}
