/**
 * Anchor resolver: maps a Markdown snippet (`suggestion.find` from backend/app/services/blocks.py,
 * or an AI-change slice) to a ProseMirror range in the rendered document.
 *
 * The snippet is parsed with the SAME extensions as the document, both sides are projected to plain
 * text with a position map, normalised like backend `edit_service._normalize`, and exactly one
 * match yields `{from, to}`. Zero or several matches are reported, never guessed.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { leafText } from "./extensions";

interface CharRange {
  from: number;
  to: number;
}

export interface PlainText {
  text: string;
  /** For every UTF-16 unit of `text`: the document positions it came from. */
  map: CharRange[];
}

/**
 * Plain-text projection of a document with a per-character position map. Text nodes contribute their
 * text, leaf atoms contribute `leafText(node)`, and a "\n" separates consecutive text blocks.
 *
 * For ordinary text and leaf content this yields the same text as
 * `doc.textBetween(0, doc.content.size, "\n", leafText)`, but it is NOT identical, in both
 * directions: `textBetween` adds a separator before every textblock except the first (so an empty
 * paragraph between "a" and "b" gives "a\n\nb"; `projectDoc` collapses it to "a\nb"), while
 * `projectDoc` separates before a textblock that follows a leading leaf block such as a
 * `horizontalRule` ("\npara"; `textBetween` gives "para"). `projectDoc` is authoritative: the
 * document and every `find` go through it, so matching stays consistent. Anything that slices the
 * document by anchor (annotations, AI-change ranges) must use this position map and never
 * `textBetween`, or offsets can drift in those cases.
 */
export function projectDoc(doc: PMNode): PlainText {
  let text = "";
  const map: CharRange[] = [];
  let separated = true;
  const push = (s: string, from: number, to: number): void => {
    text += s;
    for (let i = 0; i < s.length; i++) map.push({ from, to });
  };
  const pushText = (s: string, pos: number): void => {
    text += s;
    // Text positions are UTF-16 units, so every unit maps to its own one-unit range. This keeps the
    // resolved range tight when a match starts or ends in the middle of a text node.
    for (let i = 0; i < s.length; i++) map.push({ from: pos + i, to: pos + i + 1 });
  };
  doc.descendants((node, pos) => {
    if (node.isText) {
      pushText(node.text ?? "", pos);
      separated = false;
      return false;
    }
    if (node.isLeaf) {
      push(leafText(node), pos, pos + node.nodeSize);
      separated = false;
      return false;
    }
    if (!separated && node.isTextblock) {
      push("\n", pos, pos);
      separated = true;
    }
    return true;
  });
  return { text, map };
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
};
const HSPACE = new Set([" ", "\t", "\u00a0"]);

/** Same rules as `_normalize` (horizontal whitespace runs become one space, typographic quotes become ASCII); keeps the map. */
export function normalize(input: PlainText): PlainText {
  let text = "";
  const map: CharRange[] = [];
  const units = input.text;
  let i = 0;
  while (i < units.length) {
    const ch = units.charAt(i);
    if (HSPACE.has(ch)) {
      let j = i;
      while (j < units.length && HSPACE.has(units.charAt(j))) j++;
      text += " ";
      map.push({ from: input.map[i]?.from ?? 0, to: input.map[j - 1]?.to ?? 0 });
      i = j;
      continue;
    }
    text += QUOTES[ch] ?? ch;
    map.push(input.map[i] ?? { from: 0, to: 0 });
    i++;
  }
  return { text, map };
}

export type Resolution =
  | { status: "resolved"; from: number; to: number }
  | { status: "unresolved"; reason: "empty" | "not_found" }
  | { status: "ambiguous"; count: number };

/** The searchable form of a document; build once per document, resolve many anchors against it. */
export interface DocIndex {
  doc: PMNode;
  plain: PlainText;
}

export function indexDoc(editor: Editor): DocIndex {
  const doc = editor.state.doc;
  return { doc, plain: normalize(projectDoc(doc)) };
}

function parseToDoc(editor: Editor, markdown: string): PMNode {
  const markdownManager = editor.markdown;
  if (markdownManager === undefined) throw new Error("Markdown extension missing");
  return editor.schema.nodeFromJSON(markdownManager.parse(markdown));
}

function isBlockAligned(hay: string, at: number, length: number): boolean {
  const end = at + length;
  return (at === 0 || hay.charAt(at - 1) === "\n") && (end === hay.length || hay.charAt(end) === "\n");
}

/**
 * Resolves `find` (Markdown) against an indexed document.
 *
 * Backend finds are whole blocks whose uniqueness was decided on the Markdown source, where `## Foo`
 * differs from `Foo`. The plain-text projection lost that syntax, so hits that start and end on a
 * text-block boundary ("\n" or document edge) win over hits inside other text; only without any
 * aligned hit are all hits considered. A hard break projects to "\n" too, so it counts as a
 * boundary as well. Exactly one remaining candidate resolves, several are `ambiguous`.
 */
export function resolveAnchor(editor: Editor, index: DocIndex, find: string): Resolution {
  // Block separators at the edges carry no information, trim them like the backend's block text.
  const needle = normalize(projectDoc(parseToDoc(editor, find))).text.replace(/^\n+|\n+$/g, "");
  if (needle.trim() === "") return { status: "unresolved", reason: "empty" };
  const hay = index.plain.text;
  const hits: number[] = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) hits.push(at);
  if (hits.length === 0) return { status: "unresolved", reason: "not_found" };
  const aligned = hits.filter((at) => isBlockAligned(hay, at, needle.length));
  const candidates = aligned.length > 0 ? aligned : hits;
  if (candidates.length > 1) return { status: "ambiguous", count: candidates.length };
  const start = candidates[0] ?? 0;
  const first = index.plain.map[start];
  const last = index.plain.map[start + needle.length - 1];
  if (first === undefined || last === undefined) return { status: "unresolved", reason: "not_found" };
  return { status: "resolved", from: first.from, to: last.to };
}
