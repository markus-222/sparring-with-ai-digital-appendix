/**
 * `"auto"` (instant) when the user asked for reduced motion, otherwise `"smooth"`. `matchMedia` is
 * missing in some environments (jsdom), where smooth stays the default.
 */
export function scrollBehavior(): ScrollBehavior {
  const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  return query?.matches === true ? "auto" : "smooth";
}
