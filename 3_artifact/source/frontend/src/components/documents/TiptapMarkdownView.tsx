"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { ReferenceContext, type ReferenceContextValue } from "@/lib/richtext/referenceContext";
import { buildViewExtensions } from "@/lib/richtext/viewExtensions";
import type { Artifact, Document, Source } from "@/types";

export interface MarkdownRendererProps {
  content: string;
  /** Render line-leading `⚠ CONFLICT` / `? UNCLEAR` markers as badges (artifact reading view). */
  markers?: boolean;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
  /**
   * Called with the Tiptap editor once it exists and with `null` when it is torn down, so the
   * artifact view can read positions / apply annotations on the same instance. The editor is
   * read-only; never write Markdown back from it.
   */
  onEditorReady?: (editor: Editor | null) => void;
  /**
   * A click landed on an annotated range (see `lib/richtext/annotations.ts`); gets its comment id.
   * Read through a ref at click time, so a new callback never recreates the editor.
   */
  onAnnotationClick?: (id: string) => void;
}

const NO_DOCUMENTS: readonly Document[] = [];
const NO_ARTIFACTS: readonly Artifact[] = [];

/**
 * Constant: a fresh object per render would make `useEditor` re-apply options on every render.
 * Tiptap defaults the content element to `role="textbox"`, which is wrong for a read-only view and
 * makes it indistinguishable from the Markdown editor textarea (`getByRole("textbox")`), so it is
 * a plain `document`.
 */
const EDITOR_PROPS = { attributes: { class: "prose", role: "document", translate: "yes" } };

/**
 * Read-only Tiptap view of Markdown (client only, loaded through `next/dynamic` in
 * `MarkdownRenderer.tsx`). The editor is created once: `documents` / `artifacts` / `onOpenSource`
 * reach the citation node views through `ReferenceContext` and the link-click handler through a ref,
 * and a changed `content` is swapped in with `setContent` instead of recreating the editor.
 *
 * `markers` selects the extension set (customer documents render `⚠ CONFLICT` literally) and
 * `useEditor` ignores later extension changes, so the editor is remounted via `key` if it changes.
 */
export function TiptapMarkdownView(props: MarkdownRendererProps) {
  return <TiptapMarkdownEditor key={props.markers === true ? "markers" : "plain"} {...props} />;
}

function TiptapMarkdownEditor({
  content,
  markers = false,
  documents,
  artifacts,
  onOpenSource,
  onEditorReady,
  onAnnotationClick,
}: MarkdownRendererProps) {
  const referenceContext = useMemo<ReferenceContextValue>(
    () => ({ documents: documents ?? NO_DOCUMENTS, artifacts: artifacts ?? NO_ARTIFACTS, onOpenSource }),
    [documents, artifacts, onOpenSource],
  );
  const latestContext = useRef(referenceContext);
  useEffect(() => {
    latestContext.current = referenceContext;
  }, [referenceContext]);

  const annotationClick = useRef(onAnnotationClick);
  useEffect(() => {
    annotationClick.current = onAnnotationClick;
  }, [onAnnotationClick]);

  const extensions = useMemo(
    () =>
      buildViewExtensions(() => latestContext.current, {
        markers,
        getOnAnnotationClick: () => annotationClick.current,
      }),
    [markers],
  );

  const editor = useEditor({
    extensions,
    content,
    contentType: "markdown",
    editable: false,
    immediatelyRender: false,
    editorProps: EDITOR_PROPS,
  });

  // The editor is created from the content of the render that created it; later changes are applied here.
  const applied = useRef<{ editor: Editor; content: string } | null>(null);
  useEffect(() => {
    if (editor === null) return;
    if (applied.current?.editor !== editor) {
      applied.current = { editor, content };
      return;
    }
    if (applied.current.content === content) return;
    applied.current = { editor, content };
    editor.commands.setContent(content, { contentType: "markdown", emitUpdate: false });
  }, [editor, content]);

  const readyCallback = useRef(onEditorReady);
  useEffect(() => {
    readyCallback.current = onEditorReady;
  }, [onEditorReady]);
  useEffect(() => {
    if (editor === null) return;
    readyCallback.current?.(editor);
    return () => readyCallback.current?.(null);
  }, [editor]);

  return (
    <ReferenceContext.Provider value={referenceContext}>
      <EditorContent editor={editor} />
    </ReferenceContext.Provider>
  );
}
