"use client";

// The browse view: personas at the top level, their concepts underneath, and
// each concept's creatives under that. An accordion rather than a flat list —
// the hierarchy is the point, and a concept only makes sense read beneath the
// persona it was built for.
//
// The chevron expands; everything else on a row is a link to that record.

import { useState } from "react";
import Link from "next/link";
import {
  AWARENESS_LEVEL_LABELS,
  AwarenessLevel,
  countLabel,
  personaRollupStatus,
} from "@/lib/adhub";
import {
  ConceptStatusBadge,
  CreativeStatusBadge,
  CreativeTypeChip,
  PersonaRollupBadge,
} from "@/components/Badge";
import Icon from "@/components/Icons";

export interface TreeCreative {
  id: string;
  creativeNumber: number;
  creativeType: string;
  conceptHeadline: string;
  status: string;
  isVariation: boolean;
}

export interface TreeConcept {
  id: string;
  name: string;
  batchNumber: number;
  status: string;
  awarenessLevel: string;
  creatives: TreeCreative[];
}

export interface TreePersona {
  id: string;
  name: string;
  demographics: string | null;
  concepts: TreeConcept[];
}

export default function AdHubTree({ personas }: { personas: TreePersona[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setOpen((o) => ({ ...o, [id]: !o[id] }));

  if (personas.length === 0) {
    return (
      <div className="card p-6">
        <p className="text-sm text-muted">
          No personas yet. The new-concept wizard writes the first one — it
          starts by asking who the ad is for.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <ul>
        {personas.map((persona) => {
          const expanded = open[persona.id] ?? false;
          const creatives = persona.concepts.reduce(
            (n, c) => n + c.creatives.length,
            0,
          );
          return (
            <li
              key={persona.id}
              className="border-b border-line/60 last:border-b-0"
            >
              <Row
                expanded={expanded}
                onToggle={() => toggle(persona.id)}
                href={`/ad-hub/personas/${persona.id}`}
                indent={0}
                title={persona.name}
                subtitle={persona.demographics}
                badge={
                  <PersonaRollupBadge
                    status={personaRollupStatus(persona.concepts)}
                  />
                }
                meta={`${countLabel(persona.concepts.length, "concept")} · ${countLabel(creatives, "creative")}`}
              />

              {expanded && (
                <div className="bg-wash/30">
                  {persona.concepts.length === 0 ? (
                    <Empty indent={1}>
                      No concepts for this persona yet.{" "}
                      <Link
                        href="/ad-hub/concepts/new"
                        className="text-accent hover:underline"
                      >
                        Start one
                      </Link>
                      .
                    </Empty>
                  ) : (
                    <ul>
                      {persona.concepts.map((concept) => {
                        const conceptOpen = open[concept.id] ?? false;
                        return (
                          <li
                            key={concept.id}
                            className="border-t border-line/50"
                          >
                            <Row
                              expanded={conceptOpen}
                              onToggle={() => toggle(concept.id)}
                              href={`/ad-hub/concepts/${concept.id}`}
                              indent={1}
                              title={concept.name}
                              subtitle={
                                AWARENESS_LEVEL_LABELS[
                                  concept.awarenessLevel as AwarenessLevel
                                ] ?? concept.awarenessLevel
                              }
                              prefix={`B${concept.batchNumber}`}
                              badge={
                                <ConceptStatusBadge status={concept.status} />
                              }
                              meta={countLabel(
                                concept.creatives.length,
                                "creative",
                              )}
                            />

                            {conceptOpen &&
                              (concept.creatives.length === 0 ? (
                                <Empty indent={2}>
                                  No creatives under this concept yet.{" "}
                                  <Link
                                    href={`/ad-hub/concepts/${concept.id}/creatives/new`}
                                    className="text-accent hover:underline"
                                  >
                                    Write the first
                                  </Link>
                                  .
                                </Empty>
                              ) : (
                                <ul>
                                  {concept.creatives.map((creative) => (
                                    <li
                                      key={creative.id}
                                      className="border-t border-line/50"
                                    >
                                      <Row
                                        href={`/ad-hub/creatives/${creative.id}`}
                                        indent={2}
                                        prefix={`#${creative.creativeNumber}`}
                                        title={
                                          creative.conceptHeadline.trim() ===
                                          ""
                                            ? "Untitled hook"
                                            : creative.conceptHeadline
                                        }
                                        subtitle={
                                          creative.isVariation
                                            ? "Variation of an earlier creative"
                                            : null
                                        }
                                        badge={
                                          <span className="flex items-center gap-2">
                                            <CreativeTypeChip
                                              type={creative.creativeType}
                                            />
                                            <CreativeStatusBadge
                                              status={creative.status}
                                            />
                                          </span>
                                        }
                                      />
                                    </li>
                                  ))}
                                </ul>
                              ))}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const INDENT = ["pl-4", "pl-10", "pl-16"];

function Row({
  expanded,
  onToggle,
  href,
  indent,
  title,
  subtitle,
  prefix,
  badge,
  meta,
}: {
  expanded?: boolean;
  onToggle?: () => void;
  href: string;
  indent: number;
  title: string;
  subtitle?: string | null;
  prefix?: string;
  badge?: React.ReactNode;
  meta?: string;
}) {
  return (
    <div className={`flex items-center hover:bg-wash/60 ${INDENT[indent]}`}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <Icon
            name="chevronRight"
            className={`h-3.5 w-3.5 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </button>
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-line" aria-hidden />
        </span>
      )}
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 pr-4"
      >
        {prefix && (
          <span className="num shrink-0 text-xs text-muted">{prefix}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {subtitle && (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {subtitle}
            </span>
          )}
        </span>
        {badge}
        {meta && (
          <span className="num hidden shrink-0 text-xs text-muted sm:block">
            {meta}
          </span>
        )}
      </Link>
    </div>
  );
}

function Empty({
  indent,
  children,
}: {
  indent: number;
  children: React.ReactNode;
}) {
  return (
    <p
      className={`border-t border-line/50 py-3 pr-4 text-sm text-muted ${INDENT[indent]}`}
    >
      {children}
    </p>
  );
}
