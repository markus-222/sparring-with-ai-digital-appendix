import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyHighlight } from "@/lib/highlight";
import { mockReducedMotion, removeMatchMedia } from "@/test/reducedMotion";

describe("applyHighlight", () => {
  class FakeHighlight {
    readonly ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }

  function makeRange(): Range {
    const p = document.createElement("p");
    p.textContent = "hello world";
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    return range;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    removeMatchMedia();
    document.body.innerHTML = "";
  });

  it("registers the highlight, scrolls, and removes it after the duration", () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", FakeHighlight);
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    const range = makeRange();

    applyHighlight(range, 3000);

    const registered = registry.get("ai-change");
    expect(registered).toBeInstanceOf(FakeHighlight);
    if (!(registered instanceof FakeHighlight)) throw new Error("expected a FakeHighlight");
    expect(registered.ranges).toEqual([range]);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));

    vi.advanceTimersByTime(2999);
    expect(registry.has("ai-change")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(registry.has("ai-change")).toBe(false);
  });

  it("scrolls smoothly, or instantly with prefers-reduced-motion: reduce", () => {
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    applyHighlight(makeRange());
    expect(scroll).toHaveBeenLastCalledWith({ block: "center", behavior: "smooth" });
    mockReducedMotion(true);
    applyHighlight(makeRange());
    expect(scroll).toHaveBeenLastCalledWith({ block: "center", behavior: "auto" });
  });

  it("returns a cancel function that removes the highlight at once", () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", FakeHighlight);

    const cancel = applyHighlight(makeRange());
    expect(registry.has("ai-change")).toBe(true);
    cancel();
    expect(registry.has("ai-change")).toBe(false);
  });

  it("does nothing for a null range", () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", FakeHighlight);

    const cancel = applyHighlight(null);
    expect(registry.size).toBe(0);
    expect(() => cancel()).not.toThrow();
  });

  it("is a silent no-op where the Custom Highlight API is missing, but still scrolls", () => {
    vi.stubGlobal("CSS", {});
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();

    const cancel = applyHighlight(makeRange());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(() => cancel()).not.toThrow();
  });
});
