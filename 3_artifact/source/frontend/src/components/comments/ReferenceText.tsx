"use client";

import { FileText, Package, TriangleAlert } from "lucide-react";
import { ReferenceBadge } from "@/components/artifact/ReferenceBadge";
import { REFERENCE_PATTERN } from "@/lib/referenceLinks";
import { resolveCitation } from "@/lib/resolveReference";
import type { Artifact, Document, Source } from "@/types";

export interface ReferenceTextProps {
  text: string;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
}

/**
 * Plain text (whitespace preserved by the parent) in which `[[doc:...]]` / `[[artifact:...]]`
 * citations are shown as reference badges. For diff blocks and other non-Markdown text.
 */
export function ReferenceText({ text, documents, artifacts, onOpenSource }: ReferenceTextProps) {
  // split() with a capturing, global regex yields [text, kind, label, text, kind, label, ..., text]
  const parts = text.split(REFERENCE_PATTERN);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    nodes.push(parts[i]);
    const kind = parts[i + 1];
    const label = parts[i + 2];
    if ((kind !== "doc" && kind !== "artifact") || label === undefined) continue;
    const resolved = resolveCitation({ kind, label: label.trim(), documents, artifacts });
    const { source } = resolved;
    nodes.push(
      <ReferenceBadge
        key={i}
        icon={
          source === null ? (
            <TriangleAlert size={14} strokeWidth={2} />
          ) : resolved.kind === "document" ? (
            <FileText size={14} strokeWidth={2} />
          ) : (
            <Package size={14} strokeWidth={2} />
          )
        }
        label={resolved.label}
        disabled={source === null}
        onClick={() => source && onOpenSource?.(source)}
      />,
    );
  }
  return <>{nodes}</>;
}
