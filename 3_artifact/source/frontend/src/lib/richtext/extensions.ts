/**
 * Tiptap extension set for the read-only artifact view (Markdown in, never Markdown out).
 *
 * `buildExtensions()` is schema + Markdown tokenizers only (no React), so the anchor resolver can
 * parse a `find` snippet with exactly the same pipeline as the document. The React node views and
 * the link click interception are layered on top in `viewExtensions.tsx`.
 */
import { Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { Marked, Tokenizer, type marked } from "marked";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

export type ReferenceKind = "doc" | "artifact";
export type MarkerKind = "conflict" | "unclear";

export function isReferenceKind(value: unknown): value is ReferenceKind {
  return value === "doc" || value === "artifact";
}

export function isMarkerKind(value: unknown): value is MarkerKind {
  return value === "conflict" || value === "unclear";
}

export const SOURCE_REFERENCE_NODE = "sourceReference";
export const MARKER_NODE = "marker";

/**
 * `[[doc:file.md, 00:53]]` / `[[artifact:01]]` (analyst citation syntax, see
 * backend/app/agents/prompts/analyst_chat.md) as an inline atom. `label` keeps the raw text after
 * the colon, including a locator suffix, because `resolveCitation` needs it for the tooltip.
 */
export const SourceReferenceNode = Node.create({
  name: SOURCE_REFERENCE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { kind: { default: "doc" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-source-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-source-reference": "" })];
  },
  markdownTokenName: SOURCE_REFERENCE_NODE,
  markdownTokenizer: {
    name: SOURCE_REFERENCE_NODE,
    level: "inline",
    start: "[[",
    tokenize(src) {
      const match = /^\[\[(doc|artifact):([^\]]+)\]\]/.exec(src);
      if (match === null) return undefined;
      return {
        type: SOURCE_REFERENCE_NODE,
        raw: match[0],
        kind: match[1],
        label: (match[2] ?? "").trim(),
      };
    },
  },
  parseMarkdown(token, helpers) {
    const kind: unknown = token.kind;
    const label: unknown = token.label;
    return helpers.createNode(SOURCE_REFERENCE_NODE, {
      kind: isReferenceKind(kind) ? kind : "doc",
      label: typeof label === "string" ? label : "",
    });
  },
  renderMarkdown(node) {
    return `[[${String(node.attrs?.kind)}:${String(node.attrs?.label)}]]`;
  },
});

/**
 * Line-leading `⚠ CONFLICT` / `? UNCLEAR`: the marker may follow only list bullets,
 * heading hashes, ordered-list numbers and blockquote prefixes. An inline tokenizer sees the inline
 * source after the block-level lexer consumed `- `, `### `, `1. ` and `> `; its `tokens` argument
 * holds what was already produced for the same inline run, so `tokens.length === 0` means "at the
 * start of the block's inline content". Mid-line occurrences stay plain text.
 */
export const MarkerNode = Node.create({
  name: MARKER_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { kind: { default: "conflict" } };
  },
  parseHTML() {
    return [{ tag: "span[data-marker]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-marker": "" })];
  },
  markdownTokenName: MARKER_NODE,
  markdownTokenizer: {
    name: MARKER_NODE,
    level: "inline",
    start: (src) => src.search(/⚠|\?\s+UNCLEAR/u),
    tokenize(src, tokens) {
      if (tokens.length > 0) return undefined;
      const conflict = /^⚠️?\s+CONFLICT\b/u.exec(src);
      if (conflict !== null) return { type: MARKER_NODE, raw: conflict[0], kind: "conflict" };
      const unclear = /^\?\s+UNCLEAR\b/u.exec(src);
      if (unclear !== null) return { type: MARKER_NODE, raw: unclear[0], kind: "unclear" };
      return undefined;
    },
  },
  parseMarkdown(token, helpers) {
    const kind: unknown = token.kind;
    return helpers.createNode(MARKER_NODE, { kind: isMarkerKind(kind) ? kind : "conflict" });
  },
  renderMarkdown(node) {
    return node.attrs?.kind === "unclear" ? "? UNCLEAR" : "⚠ CONFLICT";
  },
});

/** Leading run of a fenced code block's info string that may become the `language-*` class. */
const SAFE_LANGUAGE = /^[\w+#.-]+/;

/**
 * `@tiptap/markdown` registers every extension's tokenizer on the module-wide default `marked`
 * instance, so a tokenizer (e.g. the marker tokenizer) would leak into every other editor and pile
 * up per editor. Each extension list therefore gets its own `Marked`. The manager only uses
 * `Lexer`/`defaults`/`use`/`lexer`/`setOptions`, which `Marked` provides; the option is typed as the
 * default `marked` function, hence the cast.
 *
 * Security: the instance also neutralises raw HTML, which the previous react-markdown renderer showed
 * as literal text. `@tiptap/markdown` would parse marked `html` tokens through the ProseMirror schema
 * (link `class`/`target`/`rel`, raw headings and tables, ...), and the content comes from customer
 * documents and analyst output, i.e. is attacker-influenced.
 * - The block `html` and the inline `tag` tokenizers return nothing (without falling back to the
 *   built-in ones), so marked lexes the same source as ordinary paragraph/inline text: `<a href=x>`
 *   stays the literal characters `<a href=x>`. Code spans, fences, links etc. have their own tokenizers
 *   and are unaffected. `walkTokens`/renderer overrides would not help here: `@tiptap/markdown` calls
 *   `lexer()` only, so the tokenizer is the one hook on its path.
 * - The info string of a code fence ends up in a CSS class (`language-<lang>`), so only its leading
 *   `[\w+#.-]` run is kept (`x fixed inset-0` becomes `x`); anything else yields no language.
 *
 * The anchor resolver parses through `buildExtensions` too, so it sees exactly what the view renders.
 */
function isolatedMarkdown(): AnyExtension {
  const instance = new Marked();
  instance.use({
    tokenizer: {
      html: () => undefined,
      tag: () => undefined,
      fences(this: Tokenizer, src: string) {
        const token = Tokenizer.prototype.fences.call(this, src);
        if (token === undefined) return undefined;
        const lang = SAFE_LANGUAGE.exec(token.lang ?? "")?.[0];
        return { ...token, lang };
      },
    },
  });
  return Markdown.configure({ marked: instance as unknown as typeof marked });
}

export interface BuildExtensionsOptions {
  /** Appended after the built-in extensions. */
  extra?: AnyExtension[];
  /** Replacement for `SourceReferenceNode` (e.g. `.extend({ addNodeView })`); must keep the same schema. */
  sourceReference?: AnyExtension;
  /** Replacement for `MarkerNode`; must keep the same schema. */
  marker?: AnyExtension;
  /**
   * `false` leaves `MarkerNode` (and its tokenizer) out, so `⚠ CONFLICT` / `? UNCLEAR` stay literal
   * text (customer documents). Default `true`. This changes the schema, so it must be fixed for the
   * lifetime of an editor.
   */
  markers?: boolean;
}

/**
 * Extension list shared by the document and the anchor resolver's `find` parser.
 *
 * StarterKit v3 already bundles link and underline. `trailingNode` is off so the read-only view
 * never gains a synthetic empty block that would add anchor/gutter positions. Links do not open on
 * click inside the editor; reference-like links are intercepted by `viewExtensions.tsx`, everything
 * else is a normal external link in a new tab (same as the chat renderer).
 */
export function buildExtensions({
  extra = [],
  sourceReference = SourceReferenceNode,
  marker = MarkerNode,
  markers = true,
}: BuildExtensionsOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      trailingNode: false,
      link: { openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
    }),
    isolatedMarkdown(),
    TableKit,
    sourceReference,
    ...(markers ? [marker] : []),
    ...extra,
  ];
}

/** Text a leaf node contributes to the plain-text projection (document and `find` use the same function). */
export function leafText(node: { type: { name: string }; attrs: Record<string, unknown> }): string {
  switch (node.type.name) {
    case SOURCE_REFERENCE_NODE:
      return `[[${String(node.attrs.kind)}:${String(node.attrs.label)}]]`;
    case MARKER_NODE:
      return node.attrs.kind === "unclear" ? "? UNCLEAR" : "⚠ CONFLICT";
    case "hardBreak":
      // A soft/hard line break inside a paragraph projects to "\n" and therefore counts as a
      // text-block boundary for the resolver's alignment rule (see anchors.ts).
      return "\n";
    default:
      return "";
  }
}
