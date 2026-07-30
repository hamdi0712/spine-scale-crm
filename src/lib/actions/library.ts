"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LIBRARY_CATEGORIES, LibraryCategory } from "@/lib/constants";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createLibraryEntry(formData: FormData) {
  const category = str(formData, "category");
  const title = str(formData, "title");
  if (!title || !LIBRARY_CATEGORIES.includes(category as LibraryCategory)) return;
  const body = formData.get("body");
  const entry = await prisma.libraryEntry.create({
    data: {
      category: category as string,
      title,
      body: typeof body === "string" ? body : "",
    },
  });
  revalidatePath("/library");
  redirect(`/library?category=${entry.category}&entry=${entry.id}`);
}

export async function updateLibraryEntry(id: string, formData: FormData) {
  const title = str(formData, "title");
  const body = formData.get("body");
  await prisma.libraryEntry.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      body: typeof body === "string" ? body : "",
    },
  });
  revalidatePath("/library");
}

export async function deleteLibraryEntry(id: string) {
  const entry = await prisma.libraryEntry.delete({ where: { id } });
  revalidatePath("/library");
  redirect(`/library?category=${entry.category}`);
}
