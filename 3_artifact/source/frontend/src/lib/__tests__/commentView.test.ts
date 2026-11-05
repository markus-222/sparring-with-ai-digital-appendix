import { describe, expect, it } from "vitest";
import { resultLabel, roleLabel, sourceCitations, splitComments } from "@/lib/commentView";
import { makeComment } from "@/test/msw-server";

describe("splitComments", () => {
  it("splits open comments by role, sorted by number, Reviewer and Explorer separately", () => {
    const comments = [
      makeComment({ id: "e2", role: "explorer", number: 5 }),
      makeComment({ id: "r3", role: "reviewer", number: 3 }),
      makeComment({ id: "e1", role: "explorer", number: 2 }),
      makeComment({ id: "r1", role: "reviewer", number: 1 }),
    ];
    const { reviewer, explorer, resolved } = splitComments(comments);
    expect(reviewer.map((c) => c.id)).toEqual(["r1", "r3"]);
    expect(explorer.map((c) => c.id)).toEqual(["e1", "e2"]);
    expect(resolved).toEqual([]);
  });

  it("moves every non-open status to resolved, newest first", () => {
    const comments = [
      makeComment({ id: "a", number: 1, status: "accepted", created_at: "2026-06-01T10:00:00Z" }),
      makeComment({ id: "b", number: 2, status: "rejected", created_at: "2026-06-02T10:00:00Z" }),
      makeComment({ id: "c", number: 3, status: "done_manually", created_at: "2026-06-02T10:00:00Z" }),
      makeComment({ id: "d", number: 4, status: "edited", created_at: "2026-05-01T10:00:00Z" }),
      makeComment({ id: "e", number: 5, status: "open" }),
    ];
    const { reviewer, explorer, resolved } = splitComments(comments);
    expect(reviewer.map((c) => c.id)).toEqual(["e"]);
    expect(explorer).toEqual([]);
    expect(resolved.map((c) => c.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("does not mutate its input", () => {
    const comments = [makeComment({ id: "x", number: 2 }), makeComment({ id: "y", number: 1 })];
    splitComments(comments);
    expect(comments.map((c) => c.id)).toEqual(["x", "y"]);
  });
});

describe("resultLabel", () => {
  const textChange = { kind: "text_change", find: "a", replace: "b" } as const;
  const question = { kind: "workshop_question", text: "Who decides?" } as const;

  it("labels accepted and edited comments by suggestion kind", () => {
    expect(resultLabel(makeComment({ status: "accepted", suggestion: textChange }))).toBe("Applied");
    expect(resultLabel(makeComment({ status: "edited", suggestion: textChange }))).toBe("Applied");
    expect(resultLabel(makeComment({ status: "accepted", suggestion: question }))).toBe(
      "Added to workshop questions",
    );
    expect(resultLabel(makeComment({ status: "edited", suggestion: question }))).toBe(
      "Added to workshop questions",
    );
  });

  it("labels rejected and manually resolved comments", () => {
    expect(resultLabel(makeComment({ status: "rejected" }))).toBe("Rejected");
    expect(resultLabel(makeComment({ status: "done_manually" }))).toBe("Marked as done");
  });
});

describe("roleLabel", () => {
  it("returns the role name and the hypothesis flag", () => {
    expect(roleLabel(makeComment({ role: "reviewer", hypothesis: false }))).toEqual({
      label: "Reviewer",
      hypothesis: false,
    });
    expect(roleLabel(makeComment({ role: "explorer", hypothesis: true }))).toEqual({
      label: "Explorer",
      hypothesis: true,
    });
  });
});

describe("sourceCitations", () => {
  it("keeps citations and normalises bare slots and filenames", () => {
    expect(sourceCitations(["[[doc:a.md]]", "01", " b.md "])).toBe("[[doc:a.md]] [[artifact:01]] [[doc:b.md]]");
  });

  it("is empty without sources", () => {
    expect(sourceCitations([])).toBe("");
    expect(sourceCitations(["  "])).toBe("");
  });
});
