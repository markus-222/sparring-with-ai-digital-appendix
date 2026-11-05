"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkifyReferences, createReferenceComponents, referenceUrlTransform } from "@/lib/referenceLinks";
import type { Document, Artifact, Source } from "@/types";

interface AgentMarkdownProps {
  content: string;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
}

const REMARK_PLUGINS = [remarkGfm];

/**
 * Shared Markdown renderer for agent-authored content (chat messages,
 * streaming tokens, artifact bodies). Centralizing this in one place means
 * `[[doc:...]]`/`[[artifact:...]]` references behave identically wherever
 * they appear, instead of each caller wiring up its own ReactMarkdown
 * instance (which is how they silently lost this behavior before).
 *
 * Memoized: the chat re-renders on every streamed token, and re-parsing every
 * earlier message each time is wasted work. The `components` override is kept
 * stable too, so reference links are not remounted on every render.
 */
export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  documents,
  artifacts,
  onOpenSource,
}: AgentMarkdownProps) {
  const components = useMemo(
    () => createReferenceComponents({ documents, artifacts, onOpenSource }),
    [documents, artifacts, onOpenSource],
  );
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} urlTransform={referenceUrlTransform} components={components}>
      {linkifyReferences(content)}
    </ReactMarkdown>
  );
});
