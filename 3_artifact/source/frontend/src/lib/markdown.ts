/**
 * Sanitizes partial (streaming) markdown to prevent runaway inline formatting.
 *
 * Problem: an unclosed inline delimiter (** bold, * italic, `code`) causes
 * remark to render everything after it with that style until the matching
 * closing delimiter arrives in a later chunk.  This is correct per CommonMark
 * for *complete* input, but during streaming the parser sees a paragraph that
 * is still in flight and optimistically opens the span.
 *
 * Fix: if an inline delimiter count is odd (unbalanced), remove the last
 * occurrence so that text renders as literal characters until the pair closes.
 *
 * Block-level elements (# headings, - lists, ``` fences, > blockquotes) are
 * line-terminated and handled correctly by remark even in partial content —
 * no special treatment needed.
 */
export function sanitizeStreamingMarkdown(content: string): string {
  let s = content;

  // ── Bold (**)  ─────────────────────────────────────────────────────────────
  // If there is an odd number of ** tokens the last one is unmatched.
  // Remove it so the text between renders as plain until the closing ** arrives.
  const boldCount = (s.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) {
    const idx = s.lastIndexOf("**");
    s = s.slice(0, idx) + s.slice(idx + 2);
  }

  // ── Italic (single *)  ─────────────────────────────────────────────────────
  // Count only * characters that are NOT part of a ** pair.
  const singleStarCount = (s.match(/(?<!\*)\*(?!\*)/g) ?? []).length;
  if (singleStarCount % 2 !== 0) {
    // Walk backwards and remove the last lone *
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === "*" && s[i - 1] !== "*" && s[i + 1] !== "*") {
        s = s.slice(0, i) + s.slice(i + 1);
        break;
      }
    }
  }

  // ── Inline code (single `)  ────────────────────────────────────────────────
  // Ignore ``` fences (those are block-level and render fine mid-stream).
  const noFences = s.replace(/```[\s\S]*?```/g, "").replace(/`{3,}/g, "");
  const tickCount = (noFences.match(/`/g) ?? []).length;
  if (tickCount % 2 !== 0) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === "`" && s[i - 1] !== "`" && s[i + 1] !== "`") {
        s = s.slice(0, i) + s.slice(i + 1);
        break;
      }
    }
  }

  return s;
}
