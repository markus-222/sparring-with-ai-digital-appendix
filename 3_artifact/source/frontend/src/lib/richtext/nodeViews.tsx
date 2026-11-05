"use client";

import { FileText, Package, TriangleAlert } from "lucide-react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { MarkerBadge } from "@/components/artifact/MarkerBadges";
import { ReferenceBadge } from "@/components/artifact/ReferenceBadge";
import { resolveCitation } from "@/lib/resolveReference";
import { isMarkerKind, isReferenceKind } from "./extensions";
import { useReferenceContext } from "./referenceContext";

/** `[[doc:…]]` / `[[artifact:…]]` as the same icon badge the react-markdown path renders. */
export function SourceReferenceView({ node }: ReactNodeViewProps) {
  const { documents, artifacts, onOpenSource } = useReferenceContext();
  const kind = isReferenceKind(node.attrs.kind) ? node.attrs.kind : "doc";
  const resolved = resolveCitation({ kind, label: String(node.attrs.label), documents, artifacts });
  const { source } = resolved;
  return (
    <NodeViewWrapper as="span" data-source-reference={kind}>
      <ReferenceBadge
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
      />
    </NodeViewWrapper>
  );
}

/** Line-leading `⚠ CONFLICT` / `? UNCLEAR` as the existing marker badge. */
export function MarkerView({ node }: ReactNodeViewProps) {
  const kind = isMarkerKind(node.attrs.kind) ? node.attrs.kind : "conflict";
  return (
    <NodeViewWrapper as="span">
      <MarkerBadge kind={kind} />
    </NodeViewWrapper>
  );
}
