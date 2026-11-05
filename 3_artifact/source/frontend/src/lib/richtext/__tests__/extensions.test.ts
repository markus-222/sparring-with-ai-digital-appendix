import { Editor, type JSONContent } from "@tiptap/core";
import { marked } from "marked";
import { afterEach, describe, expect, it } from "vitest";
import { buildExtensions } from "../extensions";

const editors: Editor[] = [];
function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions(),
    content: markdown,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

function collect(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  for (const child of node.content ?? []) collect(child, type, out);
  return out;
}
function textOf(node: JSONContent): string {
  return (node.text ?? "") + (node.content ?? []).map(textOf).join("");
}

describe("buildExtensions: Markdown parsing", () => {
  it("parses headings, bold and links", () => {
    const json = makeEditor("# Title\n\n## Sub\n\nSome **bold** and [a link](https://x.y).").getJSON();
    expect(collect(json, "heading").map((h) => h.attrs?.level)).toEqual([1, 2]);
    const bold = collect(json, "text").filter((t) => t.marks?.some((m) => m.type === "bold"));
    expect(bold.map((t) => t.text)).toEqual(["bold"]);
    const link = collect(json, "text").find((t) => t.marks?.some((m) => m.type === "link"));
    expect(link?.marks?.[0]?.attrs?.href).toBe("https://x.y");
  });

  it("parses nested bullet lists and ordered lists", () => {
    const json = makeEditor("- A\n  - A1\n  - A2\n- B\n\n1. one\n2. two\n").getJSON();
    expect(collect(json, "bulletList")).toHaveLength(2); // outer + nested
    expect(collect(json, "listItem")).toHaveLength(6);
    expect(collect(json, "orderedList")).toHaveLength(1);
  });

  it("parses GFM tables with a header row", () => {
    const json = makeEditor("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n").getJSON();
    expect(collect(json, "table")).toHaveLength(1);
    expect(collect(json, "tableRow")).toHaveLength(3);
    expect(collect(json, "tableHeader")).toHaveLength(2);
    expect(collect(json, "tableCell").map(textOf)).toEqual(["1", "2", "3", "4"]);
  });

  it("parses code fences and blockquotes", () => {
    const json = makeEditor("line one\nline two\n\n```\ncode\n\nmore\n```\n\n> quote\n").getJSON();
    expect(collect(json, "codeBlock")).toHaveLength(1);
    expect(collect(json, "blockquote")).toHaveLength(1);
  });

  it("does not append a trailing empty node (it would add anchor positions)", () => {
    const { doc } = makeEditor("# Only a heading").state;
    expect(doc.childCount).toBe(1);
  });

  it("bundles link and underline via StarterKit (they must not be added separately)", () => {
    const names = makeEditor("x").extensionManager.extensions.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["link", "underline", "listItem", "bulletList"]));
  });
});

describe("SourceReferenceNode tokenizer", () => {
  it("parses [[doc:...]] and [[artifact:...]] as atoms, also inside lists and tables, keeping the locator", () => {
    const json = makeEditor(
      "- Fact [[doc:interview.md, 00:53]] more\n\n| x | y |\n|---|---|\n| [[artifact:01]] | z |\n",
    ).getJSON();
    expect(collect(json, "sourceReference").map((r) => r.attrs)).toEqual([
      { kind: "doc", label: "interview.md, 00:53" },
      { kind: "artifact", label: "01" },
    ]);
  });

  it("leaves other double-bracket text alone", () => {
    const json = makeEditor("See [[unknown:thing]] here.\n").getJSON();
    expect(collect(json, "sourceReference")).toHaveLength(0);
  });

  it("serialises back to the citation syntax", () => {
    const editor = makeEditor("A [[doc:a.md, 00:53]] B\n");
    expect(editor.getMarkdown()).toContain("[[doc:a.md, 00:53]]");
  });
});

describe("tokenizer registration is isolated per buildExtensions()", () => {
  it("gives every editor its own marked instance, and none is the module-wide default", () => {
    const a = makeEditor("x");
    const b = makeEditor("x");
    expect(a.markdown?.instance).not.toBe(b.markdown?.instance);
    expect(a.markdown?.instance).not.toBe(marked);
  });

  it("does not leak the marker tokenizer from a marker editor into a plain editor or into the default marked", () => {
    const withMarkers = makeEditor("- ⚠ CONFLICT: a");
    expect(collect(withMarkers.getJSON(), "marker")).toHaveLength(1);

    const plain = new Editor({
      extensions: buildExtensions({ markers: false }),
      content: "- ⚠ CONFLICT: a",
      contentType: "markdown",
      editable: false,
    });
    editors.push(plain);
    expect(collect(plain.getJSON(), "marker")).toHaveLength(0);
    expect(textOf(plain.getJSON())).toContain("⚠ CONFLICT: a");

    // The module-wide default marked (used by anything else in the app) never saw the tokenizers.
    const tokens = JSON.stringify(marked.lexer("- ⚠ CONFLICT: a [[doc:x.md]]"));
    expect(tokens).not.toMatch(/"type":"(marker|sourceReference)"/);
  });

  it("does not pile up tokenizers on an existing editor when more editors are built", () => {
    const first = makeEditor("x");
    const count = (e: Editor): number => e.markdown?.instance.defaults.extensions?.childTokens ? Object.keys(e.markdown.instance.defaults.extensions.childTokens).length : 0;
    const inline = (e: Editor): number => e.markdown?.instance.defaults.extensions?.inline?.length ?? 0;
    const before = { count: count(first), inline: inline(first) };
    makeEditor("y");
    makeEditor("z");
    expect({ count: count(first), inline: inline(first) }).toEqual(before);
  });
});

describe("MarkerNode tokenizer", () => {
  it("parses line-leading CONFLICT / UNCLEAR markers (plain, list, heading) as atoms", () => {
    const md = [
      "- ⚠ CONFLICT: a [[doc:a.md]] vs. b [[doc:b.md]]",
      "- ? UNCLEAR: quote [[doc:c.md]]",
      "",
      "### ⚠ CONFLICT: Budget",
      "",
      "⚠️ CONFLICT: paragraph start",
      "",
      "Not a marker: mid-line ⚠ CONFLICT stays text, and so does a lone ? UNCLEAR",
    ].join("\n");
    const json = makeEditor(md).getJSON();
    expect(collect(json, "marker").map((m) => m.attrs?.kind)).toEqual(["conflict", "unclear", "conflict", "conflict"]);
    expect(collect(json, "sourceReference")).toHaveLength(3);
  });
});
