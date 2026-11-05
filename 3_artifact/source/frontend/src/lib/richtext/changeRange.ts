import type { Editor } from "@tiptap/core";
import { indexDoc, resolveAnchor } from "./anchors";

/**
 * DOM range for a ProseMirror range of the mounted view (`view.domAtPos` for both ends), or null
 * when the editor is destroyed or the DOM cannot be located. Never throws (a stale position or an
 * out-of-bounds DOM boundary yields null): the caller runs inside an animation frame, where a throw
 * would skip its F5 fallback.
 */
export function domRangeFor(editor: Editor, from: number, to: number): Range | null {
  if (editor.isDestroyed) return null;
  try {
    const { view } = editor;
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

/**
 * DOM range of an AI-changed passage: `markdownSlice` (a slice of the artifact's Markdown, treated
 * like a comment `find`) is resolved through the anchor resolver and mapped to the DOM. Null when
 * the slice is empty, not found, ambiguous or unparsable, or the editor is gone; the caller then falls back to
 * showing the top of the artifact (F5).
 */
export function changeRangeFor(editor: Editor, markdownSlice: string): Range | null {
  if (editor.isDestroyed) return null;
  try {
    const resolution = resolveAnchor(editor, indexDoc(editor), markdownSlice);
    if (resolution.status !== "resolved") return null;
    return domRangeFor(editor, resolution.from, resolution.to);
  } catch {
    return null; // the Markdown of the slice could not be parsed
  }
}
