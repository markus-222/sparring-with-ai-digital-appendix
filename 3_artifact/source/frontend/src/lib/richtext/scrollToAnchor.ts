import type { Editor } from "@tiptap/core";
import { scrollBehavior } from "@/lib/scrollBehavior";

/** True when the line at `pos` lies completely inside `scroller`'s visible box. False when unknown. */
function lineVisible(editor: Editor, pos: number, scroller: HTMLElement | null): boolean {
  if (scroller === null) return false;
  try {
    const { top, bottom } = editor.view.coordsAtPos(pos);
    const box = scroller.getBoundingClientRect();
    return top >= box.top && bottom <= box.bottom;
  } catch {
    return false; // no layout (jsdom) or a stale position
  }
}

/**
 * Scrolls the passage starting at ProseMirror position `from` into the center of the view, unless
 * its first line is already fully visible in `scroller` (then the text stays still, which avoids a
 * jump for a comment the reader is looking at). Never throws: a destroyed editor, a position
 * outside the document or a missing `scrollIntoView` (jsdom) simply do nothing.
 */
export function scrollAnchorIntoView(editor: Editor, from: number, scroller: HTMLElement | null): void {
  if (editor.isDestroyed || from < 0 || from > editor.state.doc.content.size) return;
  if (lineVisible(editor, from, scroller)) return;
  try {
    const { node } = editor.view.domAtPos(from);
    const element = node instanceof Element ? node : node.parentElement;
    if (element !== null && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    }
  } catch {
    // Position outside the current document.
  }
}
