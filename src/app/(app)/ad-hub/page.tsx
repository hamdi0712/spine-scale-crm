import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { countLabel } from "@/lib/adhub";
import AdHubNav from "@/components/AdHubNav";
import AdHubTree, { TreePersona } from "@/components/AdHubTree";

export const dynamic = "force-dynamic";

export default async function AdHubPage() {
  const personas = await prisma.persona.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      concepts: {
        orderBy: [{ batchNumber: "asc" }, { createdAt: "asc" }],
        include: {
          creatives: {
            orderBy: { creativeNumber: "asc" },
            select: {
              id: true,
              creativeNumber: true,
              creativeType: true,
              conceptHeadline: true,
              status: true,
              parentCreativeId: true,
            },
          },
        },
      },
    },
  });

  const tree: TreePersona[] = personas.map((p) => ({
    id: p.id,
    name: p.name,
    demographics: p.demographics,
    concepts: p.concepts.map((c) => ({
      id: c.id,
      name: c.name,
      batchNumber: c.batchNumber,
      status: c.status,
      awarenessLevel: c.awarenessLevel,
      creatives: c.creatives.map((cr) => ({
        id: cr.id,
        creativeNumber: cr.creativeNumber,
        creativeType: cr.creativeType,
        conceptHeadline: cr.conceptHeadline,
        status: cr.status,
        isVariation: cr.parentCreativeId != null,
      })),
    })),
  }));

  const concepts = tree.reduce((n, p) => n + p.concepts.length, 0);
  const creatives = tree.reduce(
    (n, p) => n + p.concepts.reduce((m, c) => m + c.creatives.length, 0),
    0,
  );

  return (
    <div>
      <AdHubNav
        current="browse"
        blurb="Personas, the concepts built for them, and every creative underneath"
        action={
          <>
            <Link href="/ad-hub/personas/new" className="btn">
              New persona
            </Link>
            <Link href="/ad-hub/concepts/new" className="btn-primary">
              New concept
            </Link>
          </>
        }
      />

      <div className="mt-8 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Browse</h2>
        <p className="num text-xs text-muted">
          {countLabel(tree.length, "persona")} · {countLabel(concepts, "concept")}{" "}
          · {countLabel(creatives, "creative")}
        </p>
      </div>

      <div className="mt-4">
        <AdHubTree personas={tree} />
      </div>
    </div>
  );
}
