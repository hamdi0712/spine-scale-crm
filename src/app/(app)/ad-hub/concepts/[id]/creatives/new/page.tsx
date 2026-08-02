import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createCreative } from "@/lib/actions/adhub";
import CreativeWizard from "@/components/CreativeWizard";

export const dynamic = "force-dynamic";

export default async function NewCreativePage({
  params,
}: {
  params: { id: string };
}) {
  const concept = await prisma.concept.findUnique({
    where: { id: params.id },
    include: { persona: true },
  });
  if (!concept) notFound();

  return (
    <div className="max-w-3xl">
      <Link
        href={`/ad-hub/concepts/${concept.id}`}
        className="text-sm text-accent hover:underline"
      >
        ← {concept.name}
      </Link>
      <h1 className="display mt-2 text-[32px] font-semibold">
        New creative
      </h1>
      <p className="mb-8 mt-1.5 text-sm text-muted">
        Under {concept.name}, for {concept.persona.name}
      </p>

      <CreativeWizard
        awarenessLevel={concept.awarenessLevel}
        sophisticationStage={concept.sophisticationStage}
        action={createCreative.bind(null, concept.id)}
      />
    </div>
  );
}
