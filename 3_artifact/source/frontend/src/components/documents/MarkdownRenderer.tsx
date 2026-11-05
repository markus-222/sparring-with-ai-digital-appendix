"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { MarkdownRendererProps } from "./TiptapMarkdownView";

export type { MarkdownRendererProps } from "./TiptapMarkdownView";

/**
 * Read-only Tiptap rendering of Markdown (artifact view, approved versions, customer documents),
 * with the same `[[doc:...]]`/`[[artifact:...]]` reference handling as `AgentMarkdown` so that
 * citations open the referenced item in the same document panel. The implementation lives in
 * `TiptapMarkdownView.tsx`; it is loaded with `ssr: false` so Tiptap never runs on the server. The
 * placeholder is an empty `.prose` container to avoid a layout jump while the chunk loads.
 */
export const MarkdownRenderer: ComponentType<MarkdownRendererProps> = dynamic(
  () => import("./TiptapMarkdownView").then((module) => module.TiptapMarkdownView),
  { ssr: false, loading: () => <div className="prose" /> },
);
