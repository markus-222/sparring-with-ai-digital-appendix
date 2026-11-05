import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExtensions } from "@/lib/richtext/extensions";
import { scrollAnchorIntoView } from "@/lib/richtext/scrollToAnchor";
import { mockReducedMotion, removeMatchMedia } from "@/test/reducedMotion";

const CONTENT = "## Goals\n\nShip the pilot.\n\nOwner is unclear.\n";

const editors: Editor[] = [];
function makeEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions(),
    content: CONTENT,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

/** Position of the first character of `text` in the document. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) found = pos + (node.text?.indexOf(text) ?? 0);
  });
  return found;
}

function container(top: number, bottom: number): HTMLElement {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 500, bottom - top));
  return el;
}

const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);

beforeEach(() => scroll.mockClear());
afterEach(() => {
  removeMatchMedia();
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("scrollAnchorIntoView", () => {
  it("scrolls the element of the passage to the center of the view", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 900, bottom: 916, left: 0, right: 0 });
    scrollAnchorIntoView(editor, posOf(editor, "Owner is unclear."), container(0, 600));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect((scroll.mock.contexts[0] as HTMLElement).textContent).toBe("Owner is unclear.");
  });

  it("scrolls instantly with prefers-reduced-motion: reduce", () => {
    mockReducedMotion(true);
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 900, bottom: 916, left: 0, right: 0 });
    scrollAnchorIntoView(editor, posOf(editor, "Owner is unclear."), container(0, 600));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("does nothing while the first line of the passage is already visible", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 100, bottom: 116, left: 0, right: 0 });
    scrollAnchorIntoView(editor, posOf(editor, "Owner is unclear."), container(0, 600));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("scrolls when the first line is cut off at the top or the bottom of the view", () => {
    const editor = makeEditor();
    const coords = vi.spyOn(editor.view, "coordsAtPos");
    coords.mockReturnValue({ top: -8, bottom: 8, left: 0, right: 0 });
    scrollAnchorIntoView(editor, posOf(editor, "Ship the pilot."), container(0, 600));
    coords.mockReturnValue({ top: 590, bottom: 606, left: 0, right: 0 });
    scrollAnchorIntoView(editor, posOf(editor, "Ship the pilot."), container(0, 600));
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("scrolls where the position cannot be measured (no layout)", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      throw new RangeError("no layout");
    });
    scrollAnchorIntoView(editor, posOf(editor, "Ship the pilot."), container(0, 600));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("does not throw for a position outside the document, a destroyed editor or a missing scrollIntoView", () => {
    const editor = makeEditor();
    expect(() => scrollAnchorIntoView(editor, 9999, null)).not.toThrow();
    expect(scroll).not.toHaveBeenCalled();
    const original = window.HTMLElement.prototype.scrollIntoView;
    // @ts-expect-error jsdom has no scrollIntoView; the helper must cope with that.
    window.HTMLElement.prototype.scrollIntoView = undefined;
    try {
      expect(() => scrollAnchorIntoView(editor, posOf(editor, "Ship the pilot."), null)).not.toThrow();
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original;
    }
    editor.destroy();
    expect(() => scrollAnchorIntoView(editor, 5, null)).not.toThrow();
  });
});
