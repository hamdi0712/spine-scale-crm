import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ClientStatusBadge } from "@/components/Badge";
import CapsuleBar from "@/components/CapsuleBar";

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
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="hover:bg-wash/70">
                <td className="td">
                  <Link
                    href={`/clients/${client.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {client.clinicName}
                  </Link>
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
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={6}>
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
