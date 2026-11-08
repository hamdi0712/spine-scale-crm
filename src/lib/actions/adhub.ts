"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createPersonaRecord, updatePersonaRecord } from "@/lib/adhubPersonas";
import {
  AD_COMPLIANCE_ITEMS,
  AWARENESS_LEVELS,
  AwarenessLevel,
  CONCEPT_STATUSES,
  CREATIVE_STATUSES,
  CREATIVE_TYPES,
  ConceptStatus,
  CreativeStatus,
  CreativeType,
  RESEARCH_NOTE_TYPES,
  ResearchNoteType,
  LIVE_COPY_FIELDS,
  isGatedStatus,
  readyBlockers,
  isSophisticationStage,
} from "@/lib/adhub";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(formData: FormData, key: string): number | null {
  const n = num(formData, key);
  return n == null ? null : Math.round(n);
}

function date(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function revalidateAdHub() {
  revalidatePath("/ad-hub");
}

// ─── Research notes ────────────────────────────────────────────────────────

function noteType(formData: FormData): ResearchNoteType | null {
  const t = str(formData, "type");
  return RESEARCH_NOTE_TYPES.includes(t as ResearchNoteType)
    ? (t as ResearchNoteType)
    : null;
}

export async function createResearchNote(formData: FormData) {
  const title = str(formData, "title");
  const type = noteType(formData);
  if (!title || !type) return;
  const note = await prisma.researchNote.create({
    data: { title, type, body: text(formData, "body") },
  });
  revalidatePath("/ad-hub/research");
  redirect(`/ad-hub/research?type=${note.type}&note=${note.id}`);
}

export async function updateResearchNote(id: string, formData: FormData) {
  const title = str(formData, "title");
  const type = noteType(formData);
  const note = await prisma.researchNote.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      ...(type ? { type } : {}),
      body: text(formData, "body"),
    },
  });
  revalidatePath("/ad-hub/research");
  redirect(`/ad-hub/research?type=${note.type}&note=${note.id}`);
}

export async function deleteResearchNote(id: string) {
  const note = await prisma.researchNote.delete({ where: { id } });
  revalidatePath("/ad-hub/research");
  redirect(`/ad-hub/research?type=${note.type}`);
}

// ─── Personas ──────────────────────────────────────────────────────────────

function personaFields(formData: FormData, prefix = "") {
  const key = (k: string) => (prefix ? `${prefix}${k}` : k);
  return {
    demographics: str(formData, key("demographics")),
    wantsToBeSeenAs: str(formData, key("wantsToBeSeenAs")),
    believesAboutSelf: str(formData, key("believesAboutSelf")),
    wantsToAchieve: str(formData, key("wantsToAchieve")),
    triedAndFailed: str(formData, key("triedAndFailed")),
    reasonForFailure: str(formData, key("reasonForFailure")),
  };
}

export async function createPersona(formData: FormData) {
  const name = str(formData, "name");
  if (!name) return;
  const persona = await createPersonaRecord(name, personaFields(formData));
  redirect(`/ad-hub/personas/${persona.id}`);
}

export async function updatePersona(id: string, formData: FormData) {
  // The form posts every field, so the whole set is written — a cleared box
  // clears the field.
  await updatePersonaRecord(id, {
    name: str(formData, "name") ?? "Untitled persona",
    ...personaFields(formData),
  });
}

// Concepts cascade off a persona, and creatives off those concepts — deleting
// a persona takes the whole branch of the tree with it, which is why the
// confirmation on the persona page spells out what goes.
export async function deletePersona(id: string) {
  await prisma.persona.delete({ where: { id } });
  revalidateAdHub();
  redirect("/ad-hub");
}

// ─── Desires ───────────────────────────────────────────────────────────────

export async function createDesire(formData: FormData) {
  const statement = str(formData, "statement");
  if (!statement) return;
  await prisma.desire.create({
    data: { statement, notes: str(formData, "notes") },
  });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

export async function updateDesire(id: string, formData: FormData) {
  await prisma.desire.update({
    where: { id },
    data: {
      statement: str(formData, "statement") ?? "Untitled desire",
      notes: str(formData, "notes"),
    },
  });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

export async function deleteDesire(id: string) {
  // Benefits cascade with the desire, but a desire still in use by a concept
  // must not vanish underneath it — that concept's positioning would lose the
  // want it was built to answer.
  const inUse = await prisma.concept.count({ where: { desireId: id } });
  if (inUse > 0) return;
  await prisma.desire.delete({ where: { id } });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

// ─── Benefits ──────────────────────────────────────────────────────────────

export async function createBenefit(desireId: string, formData: FormData) {
  const productName = str(formData, "productName");
  const feature = str(formData, "feature");
  const benefit = str(formData, "benefit");
  if (!productName || !feature || !benefit) return;
  await prisma.benefit.create({
    data: { desireId, productName, feature, benefit },
  });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

export async function updateBenefit(id: string, formData: FormData) {
  await prisma.benefit.update({
    where: { id },
    data: {
      productName: str(formData, "productName") ?? "Untitled product",
      feature: str(formData, "feature") ?? "",
      benefit: str(formData, "benefit") ?? "",
    },
  });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

export async function deleteBenefit(id: string) {
  const inUse = await prisma.concept.count({ where: { benefitId: id } });
  if (inUse > 0) return;
  await prisma.benefit.delete({ where: { id } });
  revalidatePath("/ad-hub/desires");
  revalidateAdHub();
}

// ─── Concepts ──────────────────────────────────────────────────────────────

// The "new concept" wizard posts once, at the end. Steps 1–3 each carry either
// the id of an existing record or the fields for a new one, so nothing is
// written until the whole thing is confirmed — abandoning the wizard half way
// leaves no orphaned personas or desires behind.
export async function createConceptFromWizard(formData: FormData) {
  const awareness = str(formData, "awarenessLevel");
  const stage = int(formData, "sophisticationStage");
  if (!AWARENESS_LEVELS.includes(awareness as AwarenessLevel)) return;
  if (stage == null || !isSophisticationStage(stage)) return;

  const name = str(formData, "name");
  if (!name) return;

  // Persona — chosen or written here.
  let personaId = str(formData, "personaId");
  if (!personaId) {
    const personaName = str(formData, "personaName");
    if (!personaName) return;
    const persona = await createPersonaRecord(
      personaName,
      personaFields(formData, "persona_"),
    );
    personaId = persona.id;
  }

  // Desire — chosen or written here.
  let desireId = str(formData, "desireId");
  if (!desireId) {
    const statement = str(formData, "desireStatement");
    if (!statement) return;
    const desire = await prisma.desire.create({
      data: { statement, notes: str(formData, "desireNotes") },
    });
    desireId = desire.id;
  }

  // Benefit — chosen or written here, always against the desire above.
  let benefitId = str(formData, "benefitId");
  if (!benefitId) {
    const productName = str(formData, "benefitProductName");
    const feature = str(formData, "benefitFeature");
    const benefitText = str(formData, "benefitBenefit");
    if (!productName || !feature || !benefitText) return;
    const benefit = await prisma.benefit.create({
      data: { desireId, productName, feature, benefit: benefitText },
    });
    benefitId = benefit.id;
  }

  const concept = await prisma.concept.create({
    data: {
      name,
      batchNumber: int(formData, "batchNumber") ?? 1,
      personaId,
      desireId,
      benefitId,
      awarenessLevel: awareness as AwarenessLevel,
      sophisticationStage: stage,
      notes: str(formData, "notes"),
    },
  });

  revalidateAdHub();
  revalidatePath("/ad-hub/desires");
  redirect(`/ad-hub/concepts/${concept.id}`);
}

export async function updateConcept(id: string, formData: FormData) {
  const status = str(formData, "status");
  const awareness = str(formData, "awarenessLevel");
  const stage = int(formData, "sophisticationStage");
  const personaId = str(formData, "personaId");
  const desireId = str(formData, "desireId");
  const benefitId = str(formData, "benefitId");

  await prisma.concept.update({
    where: { id },
    data: {
      name: str(formData, "name") ?? "Untitled concept",
      batchNumber: int(formData, "batchNumber") ?? 1,
      notes: str(formData, "notes"),
      status: CONCEPT_STATUSES.includes(status as ConceptStatus)
        ? (status as ConceptStatus)
        : undefined,
      awarenessLevel: AWARENESS_LEVELS.includes(awareness as AwarenessLevel)
        ? (awareness as AwarenessLevel)
        : undefined,
      sophisticationStage:
        stage != null && isSophisticationStage(stage) ? stage : undefined,
      ...(personaId ? { personaId } : {}),
      ...(desireId ? { desireId } : {}),
      ...(benefitId ? { benefitId } : {}),
    },
  });
  revalidateAdHub();
  revalidatePath(`/ad-hub/concepts/${id}`);
}

export async function setConceptStatus(id: string, status: string) {
  if (!CONCEPT_STATUSES.includes(status as ConceptStatus)) return;
  await prisma.concept.update({ where: { id }, data: { status } });
  revalidateAdHub();
  revalidatePath(`/ad-hub/concepts/${id}`);
}

export async function deleteConcept(id: string) {
  await prisma.concept.delete({ where: { id } });
  revalidateAdHub();
  redirect("/ad-hub");
}

// ─── Creatives ─────────────────────────────────────────────────────────────

// Creatives are numbered within their concept, so the next one continues the
// batch rather than restarting it.
async function nextCreativeNumber(conceptId: string): Promise<number> {
  const max = await prisma.creative.aggregate({
    where: { conceptId },
    _max: { creativeNumber: true },
  });
  return (max._max.creativeNumber ?? 0) + 1;
}

// Seeded at creation from AD_COMPLIANCE_ITEMS. A duplicated creative gets its
// own fresh, unchecked set: the whole point of the gate is that someone looked
// at this creative, not at the one it came from.
function seedCompliance() {
  return AD_COMPLIANCE_ITEMS.map((item, i) => ({ item, sortOrder: i }));
}

export async function createCreative(conceptId: string, formData: FormData) {
  const type = str(formData, "creativeType");
  const creative = await prisma.creative.create({
    data: {
      conceptId,
      creativeNumber: await nextCreativeNumber(conceptId),
      creativeType: CREATIVE_TYPES.includes(type as CreativeType)
        ? (type as CreativeType)
        : "PHOTO",
      rawHook: text(formData, "rawHook"),
      conceptHeadline: text(formData, "conceptHeadline"),
      adHeadline: text(formData, "adHeadline"),
      adCopy: text(formData, "adCopy"),
      cta: text(formData, "cta"),
      compliance: { create: seedCompliance() },
    },
  });
  revalidateAdHub();
  revalidatePath(`/ad-hub/concepts/${conceptId}`);
  redirect(`/ad-hub/creatives/${creative.id}`);
}

// Saving copy. If anything that goes live changed — the compliant headline,
// the ad headline, the copy or the CTA — the compliance review no longer
// describes this creative: every item is unticked, and a creative at Ready or
// beyond drops back to compliance review. The raw hook is internal and never
// goes live, so editing it alone leaves the checks alone.
export async function updateCreative(id: string, formData: FormData) {
  const current = await prisma.creative.findUnique({ where: { id } });
  if (!current) return;
  const type = str(formData, "creativeType");
  const copy = {
    conceptHeadline: text(formData, "conceptHeadline"),
    adHeadline: text(formData, "adHeadline"),
    adCopy: text(formData, "adCopy"),
    cta: text(formData, "cta"),
  };
  const copyChanged = LIVE_COPY_FIELDS.some((f) => copy[f] !== current[f]);

  await prisma.$transaction(async (tx) => {
    await tx.creative.update({
      where: { id },
      data: {
        creativeNumber: int(formData, "creativeNumber") ?? 1,
        creativeType: CREATIVE_TYPES.includes(type as CreativeType)
          ? (type as CreativeType)
          : undefined,
        rawHook: text(formData, "rawHook"),
        ...copy,
        ...(copyChanged && isGatedStatus(current.status)
          ? { status: "COMPLIANCE_REVIEW" }
          : {}),
      },
    });
    if (copyChanged) {
      await tx.complianceCheck.updateMany({
        where: { creativeId: id },
        data: { checked: false, checkedAt: null },
      });
    }
  });
  revalidateAdHub();
  revalidatePath(`/ad-hub/creatives/${id}`);
  revalidatePath(`/ad-hub/concepts/${current.conceptId}`);
}

// The compliance gate. The dropdown disables every status from Ready onward
// until the creative clears, but the rule is enforced here — the UI is a
// convenience, this is the gate.
export async function setCreativeStatus(id: string, formData: FormData) {
  const status = str(formData, "status");
  if (!CREATIVE_STATUSES.includes(status as CreativeStatus)) return;

  if (isGatedStatus(status!)) {
    const current = await prisma.creative.findUnique({
      where: { id },
      select: {
        rawHook: true,
        conceptHeadline: true,
        compliance: { select: { checked: true } },
      },
    });
    if (!current || readyBlockers(current, current.compliance).length > 0) return;
  }

  const creative = await prisma.creative.update({
    where: { id },
    data: { status: status as CreativeStatus },
  });
  revalidateAdHub();
  revalidatePath(`/ad-hub/creatives/${id}`);
  revalidatePath(`/ad-hub/concepts/${creative.conceptId}`);
}

// "Don't kill a concept, iterate on it." The copy carries over so the change
// being tested is a deliberate edit rather than a blank page, and the lineage
// records what it came from.
export async function duplicateCreative(id: string) {
  const source = await prisma.creative.findUnique({ where: { id } });
  if (!source) return;
  const copy = await prisma.creative.create({
    data: {
      conceptId: source.conceptId,
      creativeNumber: await nextCreativeNumber(source.conceptId),
      creativeType: source.creativeType,
      rawHook: source.rawHook,
      conceptHeadline: source.conceptHeadline,
      adHeadline: source.adHeadline,
      adCopy: source.adCopy,
      cta: source.cta,
      status: "DRAFT",
      parentCreativeId: source.id,
      compliance: { create: seedCompliance() },
    },
  });
  revalidateAdHub();
  revalidatePath(`/ad-hub/concepts/${source.conceptId}`);
  revalidatePath(`/ad-hub/creatives/${id}`);
  redirect(`/ad-hub/creatives/${copy.id}`);
}

export async function deleteCreative(id: string) {
  const creative = await prisma.creative.delete({ where: { id } });
  revalidateAdHub();
  revalidatePath(`/ad-hub/concepts/${creative.conceptId}`);
  redirect(`/ad-hub/concepts/${creative.conceptId}`);
}

// ─── Compliance ────────────────────────────────────────────────────────────

export async function toggleComplianceItem(id: string) {
  const current = await prisma.complianceCheck.findUnique({
    where: { id },
    select: { checked: true, creativeId: true },
  });
  if (!current) return;
  const checked = !current.checked;
  await prisma.complianceCheck.update({
    where: { id },
    data: { checked, checkedAt: checked ? new Date() : null },
  });

  // Unchecking an item on a creative at Ready or beyond takes it back to
  // compliance review — leaving it there would say it passed a check that no
  // longer holds.
  const creative = await prisma.creative.findUnique({
    where: { id: current.creativeId },
    select: { status: true },
  });
  if (!checked && creative && isGatedStatus(creative.status)) {
    await prisma.creative.update({
      where: { id: current.creativeId },
      data: { status: "COMPLIANCE_REVIEW" },
    });
  }

  revalidateAdHub();
  revalidatePath(`/ad-hub/creatives/${current.creativeId}`);
}

// ─── Performance ───────────────────────────────────────────────────────────

export async function addPerformanceLog(creativeId: string, formData: FormData) {
  await prisma.performanceLog.create({
    data: {
      creativeId,
      loggedOn: date(formData, "loggedOn") ?? new Date(),
      spend: num(formData, "spend") ?? 0,
      impressions: int(formData, "impressions"),
      ctr: num(formData, "ctr"),
      cpl: num(formData, "cpl"),
      conversions: int(formData, "conversions") ?? 0,
      notes: str(formData, "notes"),
    },
  });
  revalidatePath(`/ad-hub/creatives/${creativeId}`);
}

export async function deletePerformanceLog(id: string) {
  const log = await prisma.performanceLog.delete({ where: { id } });
  revalidatePath(`/ad-hub/creatives/${log.creativeId}`);
}
