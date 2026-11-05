import { Editor } from "@tiptap/core";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import { buildExtensions } from "../extensions";
import { indexDoc, resolveAnchor } from "../anchors";

/**
 * Raw HTML in Markdown (customer documents, analyst output steerable by prompt injection) must be
 * shown as literal text, like the previous react-markdown renderer did. `@tiptap/markdown` would
 * otherwise run it through the ProseMirror schema (class/target/rel on links, raw headings, tables).
 */

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

function parse(markdown: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions(),
    content: markdown,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

function nodeTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  return types;
}

async function view(markdown: string, props: { markers?: boolean } = {}): Promise<HTMLElement> {
  const { container } = render(<MarkdownRenderer content={markdown} {...props} />);
  const root = await waitFor(() => {
    const found = container.querySelector<HTMLElement>(".ProseMirror");
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  return root;
}

/**
 * The only anchors allowed in the output are Markdown/GFM links (a bare `https://…` inside literal
 * HTML text is autolinked): `href` plus the fixed `target`/`rel`, never an injected class.
 */
function expectOnlySafeLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll("a")) {
    expect([...anchor.attributes].map((attr) => attr.name).sort()).toEqual(["href", "rel", "target"]);
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  }
}

const EVIL_LINK = '<a href="https://evil.example" class="fixed inset-0 z-50" target="_self" rel="opener">x</a>';

describe("raw HTML in Markdown is literal text", () => {
  it("an inline <a> with class/target/rel stays visible text and creates no element", async () => {
    const root = await view(`Click ${EVIL_LINK} here`);
    await waitFor(() => expect(root).toHaveTextContent('<a href="https://evil.example"'));
    expect(root).toHaveTextContent(`Click ${EVIL_LINK} here`);
    expectOnlySafeLinks(root);
    expect(root.querySelector("a.fixed, .fixed, .inset-0, .z-50")).toBeNull();
    expect(root.querySelector('[target="_self"], [rel="opener"]')).toBeNull();
  });

  it("an HTML-only paragraph with an <a> stays literal too (block-level html token)", async () => {
    const root = await view(EVIL_LINK);
    await waitFor(() => expect(root).toHaveTextContent("<a href="));
    expectOnlySafeLinks(root);
    expect(root.querySelector(".fixed")).toBeNull();
  });

  it("the code-fence info string only contributes a sanitized language class", async () => {
    const root = await view("```x fixed inset-0 z-50 bg-red-500\nconst a = 1;\n```");
    await waitFor(() => expect(root).toHaveTextContent("const a = 1;"));
    expect(root.querySelector(".fixed, .inset-0, .z-50, .bg-red-500")).toBeNull();
    expect(root.querySelector("code")?.className).toBe("language-x");
  });

  it("drops a language that has no safe leading run entirely", async () => {
    const root = await view('```"><img src=x>\nbody\n```');
    await waitFor(() => expect(root).toHaveTextContent("body"));
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("code")?.getAttribute("class") ?? "").toBe("");
  });

  it("keeps ordinary languages such as c++, c# and objective-c", () => {
    for (const lang of ["c++", "c#", "objective-c", "ts", "x.y"]) {
      const json = parse(`\`\`\`${lang}\ncode\n\`\`\``).getJSON();
      expect(json.content?.[0]?.attrs?.language).toBe(lang);
    }
  });

  it.each([
    ["heading", "<h1>x</h1>", "h1"],
    ["details", "<details><summary>s</summary>b</details>", "details, summary"],
    ["table", "<table><tr><td colspan=9 colwidth=9999>c</td></tr></table>", "table, td, [colwidth]"],
    ["script", "<script>alert(1)</script>", "script"],
    ["img", "<img src=x onerror=alert(1)>", "img, [onerror]"],
    ["iframe", '<iframe src="https://evil.example"></iframe>', "iframe"],
    ["comment", "<!-- c -->", "div, span"],
  ])("block-level %s becomes no element", async (_name, html, selector) => {
    const root = await view(`before\n\n${html}\n\nafter`);
    await waitFor(() => expect(root).toHaveTextContent("after"));
    expect(root.querySelector(selector)).toBeNull();
    // Exactly three paragraphs: no extra block was created from the HTML.
    expect(root.querySelectorAll(":scope > p")).toHaveLength(3);
    expect(root).toHaveTextContent(html);
  });

  it("inline HTML tags inside a sentence stay literal", async () => {
    const root = await view("a <b>bold</b> and <img src=x onerror=alert(1)> and <!-- c --> end");
    await waitFor(() => expect(root).toHaveTextContent("end"));
    expect(root).toHaveTextContent("a <b>bold</b> and <img src=x onerror=alert(1)> and <!-- c --> end");
    expect(root.querySelector("b, strong, img")).toBeNull();
  });

  it("unbalanced raw HTML neither throws nor produces elements", async () => {
    const markdown = "<div>\n\nstray </p> text\n\n</div></span><p>\n\n<b>unclosed";
    expect(() => parse(markdown)).not.toThrow();
    const types = nodeTypes(parse(markdown));
    expect(types.filter((t) => t !== "paragraph" && t !== "text")).toEqual([]);
    const root = await view(markdown);
    await waitFor(() => expect(root).toHaveTextContent("stray </p> text"));
    expect(root.querySelector("div, span, b, strong")).toBeNull();
  });

  it("the anchor resolver uses the same pipeline (a find with raw HTML resolves against literal text)", () => {
    const editor = parse(`Intro\n\nClick ${EVIL_LINK} here\n\nOutro`);
    const resolution = resolveAnchor(editor, indexDoc(editor), `Click ${EVIL_LINK} here`);
    expect(resolution.status).toBe("resolved");
  });
});

describe("Markdown-native features are unaffected", () => {
  it("renders headings, lists, tables, bold, inline code, references, markers and links", async () => {
    const markdown = [
      "# Head",
      "",
      "- item one",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "Some **bold** and `<a href=x>` code and [site](https://example.com/p) and [[doc:interview.md]].",
      "",
      "- ⚠ CONFLICT: users",
      "",
      "```ts\nconst x = 1;\n```",
    ].join("\n");
    const { container } = render(<MarkdownRenderer content={markdown} markers documents={[]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Head" })).toBeInTheDocument();
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("<a href=x>").tagName).toBe("CODE");
    expect(container.querySelector("[data-source-reference]")).not.toBeNull();
    expect(container.querySelector("[data-marker]")).not.toBeNull();
    expect(container.querySelector("code.language-ts")).not.toBeNull();
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("href", "https://example.com/p");
  });

  it("external Markdown links open in a new tab with noopener noreferrer and carry no other attributes", async () => {
    await view('[site](https://example.com/p "T")');
    const link = await screen.findByRole("link", { name: "site" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoopener\b/);
    expect(link.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
    expect(link.getAttribute("class")).toBeNull();
  });

  it("a javascript: Markdown link has no clickable javascript: href", async () => {
    const root = await view("[x](javascript:alert(1))");
    await waitFor(() => expect(root).toHaveTextContent("x"));
    for (const anchor of root.querySelectorAll("a")) {
      expect(anchor.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
    }
  });
});
