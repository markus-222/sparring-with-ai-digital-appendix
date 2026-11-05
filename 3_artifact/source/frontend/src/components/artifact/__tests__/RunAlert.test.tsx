import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunAlert } from "@/components/artifact/RunAlert";
import { makeRun } from "@/test/msw-server";

describe("RunAlert", () => {
  it("renders nothing without a failure or error", () => {
    const { container } = render(<RunAlert failed={null} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("failed: shows the fixed text and the retry button calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <RunAlert failed={makeRun({ state: "failed", step: "writing", error: "llm_timeout" })} onRetry={onRetry} />,
    );
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.queryByText("llm_timeout")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a start error as an alert", () => {
    render(<RunAlert failed={null} error="Resolve all open comments first." onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Resolve all open comments first.");
  });
});
