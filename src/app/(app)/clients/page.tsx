import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { deleteClient } from "@/lib/actions/clients";
import { clientDeleteMessage } from "@/lib/constants";
import { ONBOARDING_TOTAL_STEPS, isOnboarding } from "@/lib/onboarding";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ClientStatusBadge } from "@/components/Badge";
import CapsuleBar from "@/components/CapsuleBar";
import { LocalTimeBadge } from "@/components/Clock";
import ConfirmForm from "@/components/ConfirmForm";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    orderBy: [{ status: "asc" }, { clinicName: "asc" }],
    include: { checklist: { orderBy: { sortOrder: "asc" } } },
  });

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">Clients</h1>
          <p className="mt-1.5 text-sm text-muted">
            Signed clinics and delivery progress
          </p>
        </div>
        <Link href="/clients/new" className="btn-primary">
          New client
        </Link>
      </div>

      <div className="card mt-8 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Clinic</th>
              <th className="th">Status</th>
              <th className="th">Package</th>
              <th className="th">Monthly fee</th>
              <th className="th">Contract start</th>
              <th className="th w-64">Delivery</th>
              <th className="th w-10">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="hover:bg-wash/70">
                <td className="td">
                  <div className="flex items-center gap-2.5">
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {client.clinicName}
                    </Link>
                    <LocalTimeBadge timeZone={client.timeZone} />
                  </div>
                  {isOnboarding(client.onboardingStep) && (
                    <Link
                      href={`/clients/${client.id}/onboarding`}
                      className="mt-1 block text-xs text-accent hover:underline"
                    >
                      Resume onboarding · step {client.onboardingStep} of{" "}
                      {ONBOARDING_TOTAL_STEPS}
                    </Link>
                  )}
                </td>
                <td className="td">
                  <ClientStatusBadge status={client.status} />
                </td>
                <td className="td text-muted">{client.packageName ?? "—"}</td>
                <td className="td num">
                  {fmtMoney(client.monthlyFee)}
                </td>
                <td className="td num text-xs">
                  {fmtDate(client.contractStart)}
                </td>
                <td className="td">
                  <CapsuleBar
                    items={client.checklist.map((i) => ({
                      title: i.title,
                      status: i.status,
                    }))}
                  />
                </td>
                <td className="td text-right">
                  <ConfirmForm
                    action={deleteClient.bind(null, client.id)}
                    message={clientDeleteMessage(client.clinicName)}
                    className="px-1 text-sm text-muted hover:text-bad"
                  >
                    Delete
                  </ConfirmForm>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={7}>
                  No clients yet. Convert a Won lead from the pipeline, or add
                  one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
