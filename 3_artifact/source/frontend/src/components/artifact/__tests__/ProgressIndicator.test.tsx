import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressIndicator } from "@/components/artifact/ProgressIndicator";
import { makeRun } from "@/test/msw-server";

function stateOf(label: string): string | null {
  return screen.getByText(label).closest("li")?.getAttribute("data-state") ?? null;
}

describe("ProgressIndicator", () => {
  it("draft writing: first line done, second active, rest pending", () => {
    render(<ProgressIndicator run={makeRun({ type: "draft", step: "writing" })} />);
    expect(stateOf("Analyst is reading the documents")).toBe("done");
    expect(stateOf("Analyst is writing the draft …")).toBe("active");
    expect(stateOf("Checking format")).toBe("pending");
    expect(stateOf("Done")).toBe("pending");
  });

  it("review reviewing: analyzing active, preparing pending", () => {
    render(<ProgressIndicator run={makeRun({ type: "review", step: "reviewing" })} />);
    expect(stateOf("Analyzing draft and exploring perspectives")).toBe("active");
    expect(stateOf("Preparing the comments")).toBe("pending");
  });

  it("review preparing_comments: analyzing done, preparing active", () => {
    render(<ProgressIndicator run={makeRun({ type: "review", step: "preparing_comments" })} />);
    expect(stateOf("Analyzing draft and exploring perspectives")).toBe("done");
    expect(stateOf("Preparing the comments")).toBe("active");
  });

  it("exposes the progress as a status region", () => {
    render(<ProgressIndicator run={makeRun({ step: "reading" })} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
