import Link from "next/link";
import { listIcpDefinitions } from "@/lib/icpDefinitionStore";
import {
  createIcpDefinition,
  setIcpDefinitionActive,
} from "@/lib/actions/icpDefinition";
import { disqualifierLines, sizeRangeLabel } from "@/lib/icpDefinition";
import { fmtDateTime } from "@/lib/format";
import IcpActiveToggle from "@/components/IcpActiveToggle";

export const dynamic = "force-dynamic";

// Settings → ICP — every Ideal Customer Profile, which one is active, and the
// way into each.
//
// The new scoring model judges a clinic against the active profile and nothing
// else, so the switch here is the one control on the page that changes what a
// scoring run measures. Exactly one is on at a time; switching another on
// switches the current one off.
export default async function IcpSettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string };
}) {
  const icps = await listIcpDefinitions();
  const active = icps.find((i) => i.isActive) ?? null;
  const saved = searchParams.saved
    ? icps.find((i) => i.id === searchParams.saved) ?? null
    : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-xl font-semibold">ICP</h2>
          <p className="helper-text mt-1 text-sm text-muted">
            Who you are for — the profile the new scoring model judges fit
            against, and the pain points step 2 of the outreach reads
          </p>
        </div>
        <form action={createIcpDefinition}>
          <button type="submit" className="btn">
            New ICP
          </button>
        </form>
      </div>

      {saved && (
        <div className="mb-4 rounded-[10px] border border-ok/30 bg-ok-soft/60 px-4 py-3">
          <p className="text-sm font-medium">Saved {saved.name}.</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            The next scoring run measures against it
            {saved.isActive ? "" : " once it is switched on"}.
          </p>
        </div>
      )}

      {!active && (
        <div className="mb-4 rounded-[10px] border border-warn/30 bg-warn-soft/60 px-4 py-3">
          <p className="text-sm font-medium text-ink">No ICP is active</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            The new scoring model has nothing to judge fit against, so Compare
            scoring and the new model’s queue runs will refuse to start until
            one is switched on.
          </p>
        </div>
      )}

      {icps.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm font-medium">No profiles yet</p>
          <p className="helper-text mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
            Create one with New ICP, fill in its criteria, and switch it on.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-line/60">
          {icps.map((icp) => {
            const setActive = setIcpDefinitionActive.bind(null, icp.id);
            const dq = disqualifierLines(icp).length;
            return (
              <li key={icp.id} className={`p-5 sm:p-6 ${icp.isActive ? "" : "bg-wash/30"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/settings/icp/${icp.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {icp.name}
                      </Link>
                      {icp.isActive && (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-ok-soft px-2.5 text-xs font-medium text-ok-on-soft">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="num mt-1 text-xs leading-relaxed text-muted">
                      {[
                        `${icp.coreServices.length} core · ${icp.adjacentServices.length} adjacent services`,
                        sizeRangeLabel(icp),
                        `${dq} disqualifier${dq === 1 ? "" : "s"}`,
                      ].join(" · ")}
                    </p>
                    <p className="helper-text num mt-0.5 text-xs text-muted">
                      Updated {fmtDateTime(icp.updatedAt)}
                    </p>
                  </div>
                  <IcpActiveToggle
                    name={icp.name}
                    active={icp.isActive}
                    setActive={setActive}
                  />
                </div>
                <div className="mt-3">
                  <Link href={`/settings/icp/${icp.id}`} className="text-sm text-accent hover:underline">
                    Edit →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="helper-text mt-4 text-xs leading-relaxed text-muted">
        The queue scores with the new model only after you review a dry run on{" "}
        <Link href="/discovery/compare" className="text-accent hover:underline">
          Compare scoring
        </Link>{" "}
        and apply it.
      </p>
    </div>
  );
}
