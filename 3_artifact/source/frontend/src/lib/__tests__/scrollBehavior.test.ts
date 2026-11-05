import { afterEach, describe, expect, it } from "vitest";
import { scrollBehavior } from "@/lib/scrollBehavior";
import { mockReducedMotion, removeMatchMedia } from "@/test/reducedMotion";

afterEach(removeMatchMedia);

describe("scrollBehavior", () => {
  it("is smooth where matchMedia is missing (jsdom)", () => {
    expect(window.matchMedia).toBeUndefined();
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is smooth without a reduced-motion preference", () => {
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is auto with prefers-reduced-motion: reduce", () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
  });
});
