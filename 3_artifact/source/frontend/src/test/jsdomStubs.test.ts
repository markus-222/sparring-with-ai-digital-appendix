import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { buildExtensions } from "@/lib/richtext/extensions";

/** Pins the layout stubs from `setup.ts` that ProseMirror needs in jsdom. */
describe("jsdom layout stubs (setup.ts)", () => {
  it("provides Range rects and elementFromPoint without layout information", () => {
    const range = document.createRange();
    expect(range.getClientRects()).toHaveLength(0);
    expect(range.getBoundingClientRect().height).toBe(0);
    expect(document.elementFromPoint(1, 1)).toBeNull();
    expect(document.elementsFromPoint(1, 1)).toEqual([]);
  });

  it("lets ProseMirror measure and hit-test a mounted read-only editor without throwing", () => {
    const editor = new Editor({
      element: document.body.appendChild(document.createElement("div")),
      extensions: buildExtensions(),
      content: "# Title\n\nBody text.\n",
      contentType: "markdown",
      editable: false,
    });
    try {
      expect(() => editor.view.posAtCoords({ left: 1, top: 1 })).not.toThrow();
      expect(() => editor.view.coordsAtPos(3)).not.toThrow();
    } finally {
      editor.destroy();
    }
  });

  it("survives vi.restoreAllMocks() (the stubs are plain functions, not spies)", () => {
    vi.restoreAllMocks();
    expect(document.createRange().getClientRects()).toHaveLength(0);
    expect(document.elementFromPoint(1, 1)).toBeNull();
  });
});
