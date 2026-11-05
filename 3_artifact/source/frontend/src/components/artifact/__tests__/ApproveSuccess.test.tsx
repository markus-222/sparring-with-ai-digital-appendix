import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApproveSuccess } from "@/components/artifact/ApproveSuccess";

describe("ApproveSuccess", () => {
  it("announces the approval as a status region with the artifact title", () => {
    render(<ApproveSuccess title="Vision" />);
    expect(screen.getByRole("status")).toHaveTextContent("Artifact approved");
    expect(screen.getByRole("status")).toHaveTextContent("Vision");
  });
});
