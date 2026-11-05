import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { indexDoc, projectDoc, resolveAnchor, type Resolution } from "../anchors";
import { buildExtensions, leafText } from "../extensions";
import fixtures from "./fixtures/anchors.json";

/**
 * `fixtures/anchors.json` is SYNTHETIC: four hand-written artifacts mimicking analyst output, with
 * one `find` per block produced by the real backend `blocks.py` (`split_blocks` + `resolve_block_edit`),
 * so the `find` strings contain predecessor-block joins exactly like production. It is not real data.
 */
interface Fixture {
  name: string;
  content: string;
  comments: { blockId: string; kind: string; find: string | null }[];
}

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

function resolve(markdown: string, find: string): Resolution {
  const editor = makeEditor(markdown);
  return resolveAnchor(editor, indexDoc(editor), find);
}

/** Plain text of the range a resolution points at (same projection the resolver uses). */
function quoted(markdown: string, find: string): string | null {
  const editor = makeEditor(markdown);
  const res = resolveAnchor(editor, indexDoc(editor), find);
  if (res.status !== "resolved") return null;
  return sliceProjected(editor.state.doc, res.from, res.to);
}

/**
 * Text of the doc range [from, to) according to `projectDoc`'s position map (the authoritative
 * projection), deliberately NOT `doc.textBetween`, which diverges around empty textblocks.
 */
function sliceProjected(doc: PMNode, from: number, to: number): string {
  const { text, map } = projectDoc(doc);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const range = map[i];
    if (range !== undefined && range.from >= from && range.to <= to) out += text.charAt(i);
  }
  return out;
}

describe("projectDoc", () => {
  it("matches doc.textBetween(0, size, '\\n', leafText) for ordinary content and maps every char to a position", () => {
    const md = [
      "# Title",
      "",
      "- Fact [[doc:a.md, 00:53]] and **bold**",
      "- ⚠ CONFLICT: a vs. b",
      "",
      "| x | y |",
      "|---|---|",
      "| 1 | [[artifact:01]] |",
      "",
      "Line one  ",
      "Line two",
    ].join("\n");
    const { doc } = makeEditor(md).state;
    const plain = projectDoc(doc);
    expect(plain.text).toBe(doc.textBetween(0, doc.content.size, "\n", leafText));
    expect(plain.map).toHaveLength(plain.text.length);
    for (const range of plain.map) {
      expect(range.from).toBeGreaterThanOrEqual(0);
      expect(range.to).toBeLessThanOrEqual(doc.content.size);
    }
  });

  it("differs from textBetween before a leading leaf block (horizontalRule): projectDoc separates, textBetween does not", () => {
    const { schema } = makeEditor("x");
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "horizontalRule" }, { type: "paragraph", content: [{ type: "text", text: "para" }] }],
    });
    expect(projectDoc(doc).text).toBe("\npara");
    expect(doc.textBetween(0, doc.content.size, "\n", leafText)).toBe("para");
  });

  it("differs from textBetween around an empty paragraph: textBetween separates it, projectDoc collapses it", () => {
    const { schema } = makeEditor("x");
    const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const doc = schema.nodeFromJSON({ type: "doc", content: [para("a"), { type: "paragraph" }, para("b")] });
    expect(projectDoc(doc).text).toBe("a\nb");
    expect(doc.textBetween(0, doc.content.size, "\n", leafText)).toBe("a\n\nb");
  });
});

describe("resolveAnchor", () => {
  it("resolves a list item with a citation and returns a range covering the quoted text", () => {
    const md = "# Causes\n\n- No validation of customer numbers at entry [[doc:interview_ops.md]]\n- Legacy ERP has no API\n";
    expect(quoted(md, "- No validation of customer numbers at entry [[doc:interview_ops.md]]")).toBe(
      "No validation of customer numbers at entry [[doc:interview_ops.md]]",
    );
  });

  it("resolves multi-block finds that join predecessor blocks with a blank line", () => {
    const md = "## Duplicates\n\n- Same bullet\n\nSome other paragraph.\n\n- Same bullet\n";
    expect(quoted(md, "## Duplicates\n\n- Same bullet")).toBe("Duplicates\nSame bullet");
  });

  it("resolves a whole table block (backend finds are whole blocks; a lone row is not a table in Markdown)", () => {
    const table = "| a | b |\n|---|---|\n| 1 | [[doc:x.md]] |\n| 3 | 4 |";
    expect(quoted(`Intro\n\n${table}\n\nOutro\n`, table)).toBe("a\nb\n1\n[[doc:x.md]]\n3\n4");
  });

  it("resolves markers and ignores Markdown syntax differences", () => {
    const md = "- ⚠ CONFLICT: error rate: 15% [[doc:a.md]] vs. 4% [[doc:b.md]]\n- other\n";
    expect(quoted(md, "- ⚠ CONFLICT: error rate: 15% [[doc:a.md]] vs. 4% [[doc:b.md]]")).toBe(
      "⚠ CONFLICT: error rate: 15% [[doc:a.md]] vs. 4% [[doc:b.md]]",
    );
  });

  it("tolerates typographic quotes like the backend normalisation and resolves to the original text", () => {
    const md = "The customer said \u201cwe need it by March\u201d and it\u2019s urgent.\n";
    expect(quoted(md, 'said "we need it by March" and it\'s urgent')).toBe(
      "said \u201cwe need it by March\u201d and it\u2019s urgent",
    );
    // ... and the other way round: typographic quotes in the find, ASCII quotes in the document.
    expect(quoted("He said \"yes\" and it's fine.\n", "said \u201cyes\u201d and it\u2019s fine")).toBe(
      "said \"yes\" and it's fine",
    );
  });

  it("tolerates non-breaking spaces (U+00A0) on either side and resolves to the original characters", () => {
    const nbspDoc = "Budget: 5\u00a0000\u00a0EUR per year, see below.\n";
    expect(nbspDoc).toContain("\u00a0");
    expect(quoted(nbspDoc, "5 000 EUR per year")).toBe("5\u00a0000\u00a0EUR per year");
    const spaceDoc = "Budget: 5 000 EUR per year, see below.\n";
    expect(quoted(spaceDoc, "5\u00a0000\u00a0EUR per year")).toBe("5 000 EUR per year");
  });

  it("collapses runs of spaces and tabs on both sides", () => {
    expect(quoted("Alpha   beta\t\tgamma delta.\n", "Alpha beta gamma")).toBe("Alpha   beta\t\tgamma");
    expect(quoted("Alpha beta gamma delta.\n", "beta   \t gamma")).toBe("beta gamma");
  });

  it("does not resolve a find that is longer than the whole document", () => {
    expect(resolve("Short.\n", "Short.\n\nPlus a whole lot more text that is not in the document.")).toEqual({
      status: "unresolved",
      reason: "not_found",
    });
  });

  it("counts overlapping matches as separate hits (aaa / aa is ambiguous, not unique)", () => {
    expect(resolve("aaa\n", "aa")).toEqual({ status: "ambiguous", count: 2 });
  });

  it("reports ambiguous when the same text occurs twice", () => {
    expect(resolve("- Same bullet\n- Same bullet\n", "- Same bullet")).toEqual({ status: "ambiguous", count: 2 });
  });

  it("reports unresolved:not_found when the text is gone (e.g. after a manual edit)", () => {
    expect(resolve("- Something else\n", "- Not in the document")).toEqual({
      status: "unresolved",
      reason: "not_found",
    });
  });

  it("reports unresolved:empty for a find without text", () => {
    expect(resolve("- A\n", "\n\n")).toEqual({ status: "unresolved", reason: "empty" });
  });

  describe("text-block boundary alignment", () => {
    it("prefers the block-aligned hit over a hit inside other text (heading words reused in a sentence)", () => {
      const md = "## Budget\n\nThe Budget plan is due.\n";
      expect(quoted(md, "## Budget")).toBe("Budget");
    });

    it("stays ambiguous for two identical bullets even though both are block-aligned", () => {
      expect(resolve("- Same\n- Other\n- Same\n", "- Same")).toEqual({ status: "ambiguous", count: 2 });
    });

    it("falls back to unaligned hits when none is aligned, and still requires exactly one", () => {
      expect(quoted("The quick brown fox jumps.\n\nAnother paragraph.\n", "brown fox")).toBe("brown fox");
      expect(resolve("the cat and the cat\n", "the cat")).toEqual({ status: "ambiguous", count: 2 });
    });

    it("treats a hard break as a block boundary (pinned: leafText maps hardBreak to a newline)", () => {
      // "Same line" directly after a hard break is aligned; the other occurrence is mid-paragraph.
      const editor = makeEditor("Intro text\\\nSame line\n\nNot Same line here\n");
      expect(projectDoc(editor.state.doc).text).toBe("Intro text\nSame line\nNot Same line here");
      const res = resolveAnchor(editor, indexDoc(editor), "Same line");
      expect(res.status).toBe("resolved");
      if (res.status !== "resolved") return;
      const { doc } = editor.state;
      expect(sliceProjected(doc, res.from, res.to)).toBe("Same line");
      expect(sliceProjected(doc, 0, res.from)).toBe("Intro text\n");
    });
  });
});

describe("resolveAnchor on synthetic backend-produced fixtures", () => {
  it("resolves 80 of 81 finds; the only miss is a code-fence fragment from blocks.py", () => {
    const tally = { resolved: 0, ambiguous: 0, notFound: 0, empty: 0 };
    const misses: string[] = [];
    for (const fx of fixtures as Fixture[]) {
      const editor = makeEditor(fx.content);
      const index = indexDoc(editor);
      for (const c of fx.comments) {
        if (c.find === null) continue;
        const res = resolveAnchor(editor, index, c.find);
        if (res.status === "resolved") tally.resolved++;
        else {
          if (res.status === "ambiguous") tally.ambiguous++;
          else if (res.reason === "empty") tally.empty++;
          else tally.notFound++;
          misses.push(`${fx.name} ${c.blockId}`);
        }
      }
    }
    expect(tally).toEqual({ resolved: 80, ambiguous: 0, notFound: 1, empty: 0 });
    expect(misses).toEqual(["edge B26"]);
  });
});
