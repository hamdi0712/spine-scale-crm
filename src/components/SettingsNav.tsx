"use client";

// The settings area's own navigation.
//
// A secondary nav rather than a third entry in the sidebar: everything under
// /settings changes how the app runs rather than what is in it, and that is one
// idea with sections, not several nav items. The sidebar has one "Settings"
// item; this is what you find once you are inside it.
//
// Drawn as the app's segmented control (.segment / .segment-item), the same
// treatment the Table/Board toggle and the Discovery filters wear, so a
// sub-navigation looks like a control the app already has rather than a new
// pattern invented for this page.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBuildingStore, IconGitBranch, IconKey } from "@tabler/icons-react";

export const SETTINGS_SECTIONS = [
  {
    href: "/settings/api-keys",
    label: "API Keys",
    Glyph: IconKey,
  },
  {
    href: "/settings/pipeline",
    label: "Pipeline",
    Glyph: IconGitBranch,
  },
  // Last of the three because it is the newest and the least often opened —
  // keys and the enrichment chain are changed while something is being set up,
  // and this is written once and then left alone for months.
  {
    href: "/settings/business-context",
    label: "Business context",
    Glyph: IconBuildingStore,
  },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="segment w-fit" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map((section) => {
        const active =
          pathname === section.href || pathname.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`segment-item ${active ? "segment-item-on" : ""}`}
          >
            <section.Glyph size={16} stroke={1.75} aria-hidden />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
