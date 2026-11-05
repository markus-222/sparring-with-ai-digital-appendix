import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeRangeFor, domRangeFor } from "../changeRange";
import { buildExtensions } from "../extensions";
import { indexDoc, resolveAnchor } from "../anchors";

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

/** A mounted read-only editor (domAtPos needs a real DOM tree). */
function mount(markdown: string): Editor {
  const element = document.body.appendChild(document.createElement("div"));
  hosts.push(element);
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: markdown,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** The DOM range of the passage `find` resolves to, through the same path the app uses for comments. */
function domRangeOfFind(editor: Editor, find: string): Range | null {
  const res = resolveAnchor(editor, indexDoc(editor), find);
  if (res.status !== "resolved") throw new Error(`find did not resolve: ${res.status}`);
  return domRangeFor(editor, res.from, res.to);
}

describe("domRangeFor", () => {
  it("covers a passage inside one paragraph exactly", () => {
    const editor = mount("Intro line.\n\nThe quick brown fox jumps.\n");
    expect(domRangeOfFind(editor, "brown fox")?.toString()).toBe("brown fox");
  });

  it("ends exactly at the end of the block when the passage is the whole block", () => {
    const editor = mount("First block.\n\nSecond block.\n\nThird block.\n");
    const range = domRangeOfFind(editor, "Second block.");
    expect(range?.toString()).toBe("Second block.");
    const paragraph = [...editor.view.dom.querySelectorAll("p")].find((p) => p.textContent === "Second block.");
    if (paragraph === undefined || range === null) throw new Error("setup");
    const block = document.createRange();
    block.selectNodeContents(paragraph);
    // The range starts and ends exactly at the boundaries of the paragraph's content.
    expect(range.compareBoundaryPoints(Range.START_TO_START, block)).toBe(0);
    expect(range.compareBoundaryPoints(Range.END_TO_END, block)).toBe(0);
  });

  it("spans several blocks, heading included", () => {
    const editor = mount("## Duplicates\n\n- Same bullet\n\nSome other paragraph.\n\n- Same bullet\n");
    const range = domRangeOfFind(editor, "## Duplicates\n\n- Same bullet");
    expect(range?.toString()).toBe("DuplicatesSame bullet");
    const heading = editor.view.dom.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(range?.intersectsNode(heading as Node)).toBe(true);
  });

  it("covers a whole table", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    const editor = mount(`Intro\n\n${table}\n\nOutro\n`);
    const range = domRangeOfFind(editor, table);
    expect(range?.toString()).toBe("ab1234");
    const cells = [...editor.view.dom.querySelectorAll("th, td")];
    expect(cells).toHaveLength(6);
    for (const cell of cells) expect(range?.intersectsNode(cell)).toBe(true);
  });

  it("includes citation and marker atoms that lie inside the range", () => {
    const editor = mount("- ⚠ CONFLICT: rate 15% [[doc:a.md, 00:53]] vs. 4% [[artifact:02]]\n- other\n");
    const range = domRangeOfFind(editor, "- ⚠ CONFLICT: rate 15% [[doc:a.md, 00:53]] vs. 4% [[artifact:02]]");
    expect(range).not.toBeNull();
    const fragment = (range as Range).cloneContents();
    expect(fragment.querySelector("[data-marker]")).not.toBeNull();
    expect(fragment.querySelectorAll("[data-source-reference]")).toHaveLength(2);
    expect(range?.toString()).toContain("rate 15%");
    expect(range?.toString()).toContain("vs. 4%");
    expect(range?.toString()).not.toContain("other");
  });

  it("returns null for a destroyed editor", () => {
    const editor = mount("Some text.\n");
    editor.destroy();
    expect(domRangeFor(editor, 1, 5)).toBeNull();
  });

  it("returns null instead of throwing when the position cannot be mapped to the DOM", () => {
    const editor = mount("Some text.\n");
    vi.spyOn(editor.view, "domAtPos").mockImplementation(() => {
      throw new RangeError("Position outside of document");
    });
    expect(domRangeFor(editor, 1, 5)).toBeNull();
  });

  it("returns null instead of throwing when the DOM boundary is invalid for a Range", () => {
    const editor = mount("Some text.\n");
    const text = editor.view.dom.querySelector("p")?.firstChild;
    if (text === null || text === undefined) throw new Error("no text node");
    vi.spyOn(editor.view, "domAtPos").mockReturnValue({ node: text, offset: 9999 });
    expect(domRangeFor(editor, 1, 5)).toBeNull();
  });
});

describe("changeRangeFor", () => {
  it("maps a Markdown slice of the artifact to its DOM passage", () => {
    const editor = mount("## Causes\n- Shortened cause\n- Old cause two");
    expect(changeRangeFor(editor, "- Shortened cause")?.toString()).toBe("Shortened cause");
  });

  it("maps a multi-block slice (heading plus list item)", () => {
    const editor = mount("## Causes\n\n- Shortened cause\n- Old cause two\n");
    expect(changeRangeFor(editor, "## Causes\n\n- Shortened cause")?.toString()).toBe("CausesShortened cause");
  });

  it("maps a slice that ends at the end of the last block", () => {
    const editor = mount("Intro.\n\nLast paragraph.");
    const range = changeRangeFor(editor, "Last paragraph.");
    expect(range?.toString()).toBe("Last paragraph.");
  });

  it("returns null for empty, unknown and ambiguous slices", () => {
    const editor = mount("- Same line\n- Same line\n- Other\n");
    expect(changeRangeFor(editor, "")).toBeNull();
    expect(changeRangeFor(editor, "- Not in the document")).toBeNull();
    expect(changeRangeFor(editor, "- Same line")).toBeNull();
  });

  it("returns null for a destroyed editor", () => {
    const editor = mount("Some text.\n");
    editor.destroy();
    expect(changeRangeFor(editor, "Some text.")).toBeNull();
  });

  it("returns null instead of throwing when the DOM mapping fails after the slice resolved", () => {
    const editor = mount("Some text.\n");
    vi.spyOn(editor.view, "domAtPos").mockImplementation(() => {
      throw new RangeError("stale");
    });
    expect(changeRangeFor(editor, "Some text.")).toBeNull();
  });

  it("returns null instead of throwing when resolving the slice throws", () => {
    const editor = mount("Some text.\n");
    const manager = editor.markdown;
    if (manager === undefined) throw new Error("Markdown extension missing");
    vi.spyOn(manager, "parse").mockImplementation(() => {
      throw new Error("Failed to parse markdown");
    });
    expect(() => changeRangeFor(editor, "Some text.")).not.toThrow();
    expect(changeRangeFor(editor, "Some text.")).toBeNull();
  });
});
