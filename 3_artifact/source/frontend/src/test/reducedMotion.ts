import { vi } from "vitest";

/** Installs a `matchMedia` that reports `reduce` for the reduced-motion query (jsdom has none). */
export function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
  })) as unknown as typeof window.matchMedia;
}

/** Back to jsdom's state (no `matchMedia`); call from `afterEach`. */
export function removeMatchMedia(): void {
  Reflect.deleteProperty(window, "matchMedia");
}
