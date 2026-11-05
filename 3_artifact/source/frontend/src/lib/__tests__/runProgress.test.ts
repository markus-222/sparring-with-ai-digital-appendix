import { describe, expect, it } from "vitest";
import { progressLines } from "@/lib/runProgress";
import type { Run } from "@/types";

type Input = Pick<Run, "type" | "step" | "state">;

function states(run: Input): Array<[string, string]> {
  return progressLines(run).map((l) => [l.label, l.state]);
}

describe("progressLines (draft)", () => {
  it("lists the draft lines", () => {
    expect(progressLines({ type: "draft", step: "reading", state: "running" }).map((l) => l.label)).toEqual([
      "Analyst is reading the documents",
      "Analyst is writing the draft …",
      "Checking format",
      "Done",
    ]);
  });

  it("reading: first active, rest pending", () => {
    expect(states({ type: "draft", step: "reading", state: "running" })).toEqual([
      ["Analyst is reading the documents", "active"],
      ["Analyst is writing the draft …", "pending"],
      ["Checking format", "pending"],
      ["Done", "pending"],
    ]);
  });

  it("writing: first done, second active", () => {
    expect(states({ type: "draft", step: "writing", state: "running" })).toEqual([
      ["Analyst is reading the documents", "done"],
      ["Analyst is writing the draft …", "active"],
      ["Checking format", "pending"],
      ["Done", "pending"],
    ]);
  });

  it("checking_format and saving both activate Checking format", () => {
    for (const step of ["checking_format", "saving"]) {
      expect(states({ type: "draft", step, state: "running" })).toEqual([
        ["Analyst is reading the documents", "done"],
        ["Analyst is writing the draft …", "done"],
        ["Checking format", "active"],
        ["Done", "pending"],
      ]);
    }
  });

  it("null step makes the first line active", () => {
    expect(states({ type: "draft", step: null, state: "running" })[0]).toEqual([
      "Analyst is reading the documents",
      "active",
    ]);
  });

  it("succeeded makes everything done", () => {
    expect(states({ type: "draft", step: "saving", state: "succeeded" }).every(([, s]) => s === "done")).toBe(true);
  });
});

describe("progressLines (review)", () => {
  const ANALYZING = "Analyzing draft and exploring perspectives";
  const PREPARING = "Preparing the comments";

  it("lists the review lines", () => {
    expect(progressLines({ type: "review", step: "reading", state: "running" }).map((l) => l.label)).toEqual([
      ANALYZING,
      PREPARING,
    ]);
  });

  it("reading, checking_format and reviewing activate the analyzing line", () => {
    for (const step of ["reading", "checking_format", "reviewing"]) {
      expect(states({ type: "review", step, state: "running" })).toEqual([
        [ANALYZING, "active"],
        [PREPARING, "pending"],
      ]);
    }
  });

  it("preparing_comments", () => {
    expect(states({ type: "review", step: "preparing_comments", state: "running" })).toEqual([
      [ANALYZING, "done"],
      [PREPARING, "active"],
    ]);
  });

  it("null step makes the first line active", () => {
    expect(states({ type: "review", step: null, state: "running" })[0]).toEqual([ANALYZING, "active"]);
  });

  it("succeeded makes everything done", () => {
    expect(
      states({ type: "review", step: "preparing_comments", state: "succeeded" }).every(([, s]) => s === "done"),
    ).toBe(true);
  });
});
