import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createConceptFromWizard } from "@/lib/actions/adhub";
import ConceptWizard from "@/components/ConceptWizard";

export const dynamic = "force-dynamic";

export default async function NewConceptPage() {
  const [personas, desires, benefits] = await Promise.all([
    prisma.persona.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, demographics: true },
    }),
    prisma.desire.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, statement: true },
    }),
    prisma.benefit.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        desireId: true,
        productName: true,
        feature: true,
        benefit: true,
      },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <Link href="/ad-hub" className="text-sm text-accent hover:underline">
        ← Ad Hub
      </Link>
      <h1 className="mt-2 text-[32px] font-bold tracking-[-0.02em]">
        New concept
      </h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">
        Persona, desire, benefit, positioning — decided before a word of copy is
        written
      </p>

      <ConceptWizard
        personas={personas}
        desires={desires}
        benefits={benefits}
        action={createConceptFromWizard}
      />
    </div>
  );
}
