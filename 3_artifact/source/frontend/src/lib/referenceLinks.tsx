"use client";

import { defaultUrlTransform, type Components } from "react-markdown";
import { FileText, Package, TriangleAlert } from "lucide-react";
import { ReferenceBadge } from "@/components/artifact/ReferenceBadge";
import { resolveReference } from "@/lib/resolveReference";
import type { Document, Artifact, Source } from "@/types";

/**
 * Agents cite sources using a custom `[[doc:<filename>]]` / `[[artifact:<slot>]]`
 * syntax (see backend/app/agents/prompts/analyst_chat.md), not standard Markdown
 * links. `react-markdown` has no idea what to do with that — it renders it
 * as literal text. This turns those references into real Markdown links
 * (`doc://...` / `artifact://...`) *before* parsing, so the normal Markdown
 * pipeline (remark/rehype) picks them up, and `createReferenceComponents`
 * below supplies a custom `a` renderer that turns them into clickable
 * buttons instead of following the fake URL scheme.
 */
export const REFERENCE_PATTERN = /\[\[(doc|artifact):([^\]]+)\]\]/g;

export function linkifyReferences(content: string): string {
  return content.replace(REFERENCE_PATTERN, (_match, kind: string, id: string) => {
    const label = id.trim();
    return `[${label}](${kind}://${encodeURIComponent(label)})`;
  });
}

/**
 * react-markdown's default URL sanitising blanks every non-standard scheme (`href` becomes `""`),
 * which would drop the `doc://` and `artifact://` links produced above. This keeps
 * exactly those schemes and leaves every other URL to the default transform.
 */
export function referenceUrlTransform(url: string): string {
  return /^(?:doc|artifact):\/\//.test(url) ? url : defaultUrlTransform(url);
}

interface ReferenceHandlers {
  documents?: Document[];
  artifacts?: Artifact[];
  /** A citation was clicked: a customer document by id, or the artifact of a slot. */
  onOpenSource?: (source: Source) => void;
}

/** Flattens a react-markdown `children` prop (string | node | node[]) into plain text. */
function childrenToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  return "";
}

/**
 * Builds the `components` override for `react-markdown` that intercepts
 * document/artifact references and renders them as clickable reference
 * badges instead of plain anchors, so clicking them switches the document
 * viewer in place instead of navigating/opening a new tab.
 *
 * Two link shapes are recognized:
 * 1. `doc://...` / `artifact://...` — produced by `linkifyReferences` from
 *    the agents' `[[doc:<filename>]]` / `[[artifact:<id>]]` citation syntax
 *    (see backend/app/agents/prompts/analyst_chat.md).
 * 2. Plain Markdown links whose `href` or visible text matches a known
 *    document filename or artifact title — agents don't always follow the
 *    citation syntax and sometimes just emit `[filename.md](filename.md)`
 *    or similar; without this, those links fell through to the generic
 *    external-link fallback below and opened a new tab pointed at the
 *    current page (since the "URL" is just a bare filename).
 *
 * Anything that doesn't match either shape (real external `https://` links,
 * `mailto:`, etc.) still renders as a normal link that opens in a new tab.
 *
 * References that can't be resolved against the currently loaded
 * documents/artifacts (deleted, or – for artifacts – simply not visible in
 * this session, see ArtifactStoreImpl's visibility rules) render as a
 * disabled button with a "not found" warning instead of a silent no-op or a
 * click that goes nowhere. Distinguishing "deleted" from "exists but not
 * visible here" is a later refinement.
 */
export function createReferenceComponents({
  documents = [],
  artifacts = [],
  onOpenSource,
}: ReferenceHandlers): Components {
  return {
    a: ({ href, children }) => {
      const resolved = resolveReference({
        href,
        text: childrenToText(children),
        documents,
        artifacts,
      });
      if (resolved !== null) {
        const { source } = resolved;
        return (
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
        );
      }

      return (
        <a href={href} target="_blank" rel="noreferrer" className="underline">
          {children}
        </a>
      );
    },
  };
}
