import { describe, expect, it } from "vitest";
import { sharedRatio, wordDiff } from "@/lib/textDiff";

describe("wordDiff", () => {
  it("marks a single swapped word", () => {
    expect(wordDiff("The DPO signs off.", "The CISO signs off.")).toEqual([
      { type: "equal", text: "The " },
      { type: "removed", text: "DPO" },
      { type: "added", text: "CISO" },
      { type: "equal", text: " signs off." },
    ]);
  });

  it("shows an appended sentence as one addition", () => {
    expect(wordDiff("Keep it short.", "Keep it short. Quantify it.")).toEqual([
      { type: "equal", text: "Keep it short." },
      { type: "added", text: " Quantify it." },
    ]);
  });

  it("joins neighbouring word changes into one removal and one addition", () => {
    expect(wordDiff("a quick brown fox", "a slow red fox")).toEqual([
      { type: "equal", text: "a " },
      { type: "removed", text: "quick brown" },
      { type: "added", text: "slow red" },
      { type: "equal", text: " fox" },
    ]);
  });

  it("keeps a citation in one piece", () => {
    const segments = wordDiff("See [[doc:Kick-off notes]].", "See [[doc:Kick-off minutes]].");
    expect(segments).toEqual([
      { type: "equal", text: "See " },
      { type: "removed", text: "[[doc:Kick-off notes]]" },
      { type: "added", text: "[[doc:Kick-off minutes]]" },
      { type: "equal", text: "." },
    ]);
  });
});

describe("sharedRatio", () => {
  it("is high for a one-word change and low for a rewrite", () => {
    expect(sharedRatio(wordDiff("The DPO signs off every release.", "The CISO signs off every release."))).toBeGreaterThan(0.7);
    expect(sharedRatio(wordDiff("Students enrol online.", "Admins import every course."))).toBeLessThan(0.4);
  });

  it("is 1 for two empty texts", () => {
    expect(sharedRatio(wordDiff("", ""))).toBe(1);
  });
});
