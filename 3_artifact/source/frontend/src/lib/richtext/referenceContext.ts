"use client";

import { createContext, useContext } from "react";
import type { Artifact, Document, Source } from "@/types";

/**
 * What citation node views (and the plain-link click handler) need to resolve and open references.
 * Provide it above `<EditorContent>`: node views are rendered through React portals owned by
 * `EditorContent`, so the context tree is preserved and updates re-render existing node views
 * without recreating the editor.
 */
export interface ReferenceContextValue {
  documents: readonly Document[];
  artifacts: readonly Artifact[];
  /** A citation was clicked: a customer document by id, or the artifact of a slot. */
  onOpenSource?: (source: Source) => void;
}

const EMPTY: ReferenceContextValue = { documents: [], artifacts: [] };

/** Without a provider every citation resolves to "not available" (disabled badge). */
export const ReferenceContext = createContext<ReferenceContextValue>(EMPTY);

export function useReferenceContext(): ReferenceContextValue {
  return useContext(ReferenceContext);
}
