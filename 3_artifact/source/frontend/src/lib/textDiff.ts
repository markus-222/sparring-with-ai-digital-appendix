import { diffArrays } from "diff";

export interface DiffSegment {
  type: "equal" | "removed" | "added";
  text: string;
}

/** Below this share of unchanged text the change reads better as old block → new block. */
export const MIN_SHARED_RATIO = 0.4;

// A citation is one token, so a segment never cuts a `[[doc:...]]` / `[[artifact:...]]` badge apart.
const TOKEN = /\[\[(?:doc|artifact):[^\]]+\]\]|\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

const isBlank = (text: string): boolean => text.trim() === "";

/**
 * Word-level diff of `before` → `after`. Whitespace between two changes joins the change, and each
 * change run is emitted as one removal followed by one addition ("the quick" → "a slow" reads as
 * -"the quick" +"a slow", not as two word swaps).
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const raw: DiffSegment[] = diffArrays(tokenize(before), tokenize(after)).map((c) => ({
    type: c.added ? "added" : c.removed ? "removed" : "equal",
    text: c.value.join(""),
  }));

  const out: DiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = (): void => {
    if (removed) out.push({ type: "removed", text: removed });
    if (added) out.push({ type: "added", text: added });
    removed = "";
    added = "";
  };
  raw.forEach((seg, i) => {
    if (seg.type === "removed") removed += seg.text;
    else if (seg.type === "added") added += seg.text;
    else if (isBlank(seg.text) && (removed || added) && raw[i + 1] !== undefined) {
      // Whitespace between two changes: it belongs to both the old and the new wording.
      removed += seg.text;
      added += seg.text;
    } else {
      flush();
      out.push(seg);
    }
  });
  flush();
  return out;
}

/** Share of the longer text that is unchanged (whitespace not counted). */
export function sharedRatio(segments: DiffSegment[]): number {
  const length = (type: DiffSegment["type"]): number =>
    segments.filter((s) => s.type === type).reduce((n, s) => n + s.text.replace(/\s/g, "").length, 0);
  const equal = length("equal");
  const longest = Math.max(equal + length("removed"), equal + length("added"));
  return longest === 0 ? 1 : equal / longest;
}
