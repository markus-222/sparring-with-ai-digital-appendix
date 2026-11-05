import type { Artifact, Document, Source } from "@/types";

/**
 * Pure lookup of a document/artifact citation against the loaded documents and artifacts. Shared by
 * the react-markdown chat path (`createReferenceComponents`) and the Tiptap read view (citation
 * nodes and plain-link click interception), so both worlds label and resolve references identically.
 */

export interface ResolvedReference {
  kind: "document" | "artifact";
  /** Badge label / tooltip. */
  label: string;
  /** What to open on click, or null when the target is not available (rendered disabled). */
  source: Source | null;
}

export interface ReferenceLookup {
  documents?: readonly Document[];
  artifacts?: readonly Artifact[];
}

const DOCUMENT_UNAVAILABLE = "Document not available";
const ARTIFACT_UNAVAILABLE = "Artifact not available";

/**
 * Strips a leading path and any `doc://`/`artifact://` scheme, plus a
 * trailing timestamp/locator suffix, so a link's `href` (or visible text)
 * can be compared against a bare document filename.
 *
 * Handles: `doc://foo.md` → `foo.md`, `./foo.md` → `foo.md`, and — because
 * the analyst agent sometimes cites a specific point in a transcript as
 * `[[doc:foo.md, 00:53]]` or `foo.md, 00:06–00:10` even though the prompt's
 * citation syntax (see backend/app/agents/prompts/analyst_chat.md) only
 * specifies `[[doc:<filename>]]` — anything after the first `,` is dropped
 * too: `foo.md, 00:53` → `foo.md`.
 */
export function normalizeFilenameCandidate(value: string): string {
  try {
    value = decodeURIComponent(value);
  } catch {
    // leave as-is if not valid percent-encoding
  }
  return (
    value
      .replace(/^(doc|artifact):\/\//, "")
      .split("/")
      .pop()
      ?.split(",")[0]
      .trim() ?? value
  );
}

/**
 * Extracts a timestamp/locator suffix after the first `,` in a raw citation
 * label, e.g. `"transkript.md, 00:06–00:10"` → `"00:06–00:10"`. Returns null
 * when there's no such suffix, so it can be appended to the tooltip without
 * duplicating the (now icon-only) filename in the visible UI.
 */
export function extractLocatorSuffix(value: string): string | null {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return null;
  const suffix = value.slice(commaIndex + 1).trim();
  return suffix.length > 0 ? suffix : null;
}

function resolveDocument(candidates: string[], text: string, documents: readonly Document[]): ResolvedReference {
  const doc = documents.find((d) => candidates.includes(d.filename));
  if (doc === undefined) return { kind: "document", label: DOCUMENT_UNAVAILABLE, source: null };
  const locator = extractLocatorSuffix(text || candidates[0] || "");
  return {
    kind: "document",
    label: `${doc.filename}${locator ? ` (${locator})` : ""}`,
    source: { kind: "document", documentId: doc.id },
  };
}

function resolveArtifact(artifact: Artifact | undefined): ResolvedReference {
  if (artifact === undefined || artifact.slot === null) {
    return { kind: "artifact", label: ARTIFACT_UNAVAILABLE, source: null };
  }
  return {
    kind: "artifact",
    label: `${artifact.slot} · ${artifact.title}`,
    source: { kind: "artifact", slot: artifact.slot },
  };
}

/**
 * Resolves a link (`href` + visible `text`) to a document/artifact reference, or null for an
 * ordinary link.
 *
 * - `doc://…` / `artifact://…` are explicit citations (from `linkifyReferences`) and always
 *   resolve; an unknown target yields `source: null` plus a "not available" label.
 * - Any other link resolves only when its href or text names a known document filename or the title
 *   of a slotted artifact (agents don't always follow the citation syntax).
 */
export function resolveReference({
  href,
  text,
  documents = [],
  artifacts = [],
}: ReferenceLookup & { href?: string | null; text: string }): ResolvedReference | null {
  const candidates = [href, text].filter((v): v is string => Boolean(v)).map(normalizeFilenameCandidate);

  if (href?.startsWith("doc://")) return resolveDocument(candidates, text, documents);
  if (href?.startsWith("artifact://")) {
    return resolveArtifact(artifacts.find((a) => a.slot !== null && candidates.includes(a.slot)));
  }

  if (documents.some((d) => candidates.includes(d.filename))) return resolveDocument(candidates, text, documents);
  const byTitle = artifacts.find((a) => a.slot !== null && candidates.includes(a.title));
  return byTitle === undefined ? null : resolveArtifact(byTitle);
}

/**
 * Resolves a `[[doc:<label>]]` / `[[artifact:<label>]]` citation (Tiptap node attributes) exactly
 * like the equivalent explicit link that `linkifyReferences` would produce.
 */
export function resolveCitation({
  kind,
  label,
  documents = [],
  artifacts = [],
}: ReferenceLookup & { kind: "doc" | "artifact"; label: string }): ResolvedReference {
  const candidates = [`${kind}://${encodeURIComponent(label)}`, label].map(normalizeFilenameCandidate);
  if (kind === "doc") return resolveDocument(candidates, label, documents);
  return resolveArtifact(artifacts.find((a) => a.slot !== null && candidates.includes(a.slot)));
}
