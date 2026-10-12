import Link from "next/link";
import { notFound } from "next/navigation";
import { loadIcpDefinition } from "@/lib/icpDefinitionStore";
import {
  deleteIcpDefinition,
  saveIcpDefinition,
} from "@/lib/actions/icpDefinition";
import IcpDefinitionForm from "@/components/IcpDefinitionForm";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

// One ICP Definition, editable. The three cards are the form; deleting sits
// outside it, and only for a profile that is not the active one.
export default async function IcpEditPage({
  params,
}: {
  params: { id: string };
}) {
  const icp = await loadIcpDefinition(params.id);
  if (!icp) notFound();

  const save = saveIcpDefinition.bind(null, icp.id);
  const remove = deleteIcpDefinition.bind(null, icp.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/settings/icp" className="text-sm text-accent hover:underline">
            ← ICP
          </Link>
          <h2 className="display mt-2 truncate text-xl font-semibold">{icp.name}</h2>
        </div>
        {!icp.isActive && (
          <ConfirmForm
            action={remove}
            message={`Delete ${icp.name}? Candidates already scored against it keep their stored breakdowns.`}
            className="btn-danger"
          >
            Delete
          </ConfirmForm>
        )}
      </div>
      <IcpDefinitionForm icp={icp} save={save} />
    </div>
  );
}
