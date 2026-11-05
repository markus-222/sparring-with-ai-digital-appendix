import { scrollBehavior } from "@/lib/scrollBehavior";

/** Name of the CSS Custom Highlight registered for AI changes (styled in globals.css). */
export const HIGHLIGHT_NAME = "ai-change";

function startElement(range: Range): Element | null {
  const container = range.startContainer;
  return container instanceof Element ? container : container.parentElement;
}

function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/**
 * Scrolls the range into view and highlights it for `durationMs` using the CSS Custom Highlight
 * API (no DOM mutation). Where the API is missing it only scrolls. Returns a cancel function.
 */
export function applyHighlight(range: Range | null, durationMs = 3000): () => void {
  if (range === null) return () => undefined;
  startElement(range)?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  if (!highlightsSupported()) return () => undefined;

  const highlight = new Highlight(range);
  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const remove = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (CSS.highlights.get(HIGHLIGHT_NAME) === highlight) CSS.highlights.delete(HIGHLIGHT_NAME);
  };
  timer = setTimeout(remove, durationMs);
  return remove;
}
