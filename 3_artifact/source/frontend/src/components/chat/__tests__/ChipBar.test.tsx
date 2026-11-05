import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipBar } from "@/components/chat/ChipBar";

describe("ChipBar", () => {
  it("shows the comment title", () => {
    render(<ChipBar title="DPO missing" onClear={vi.fn()} />);
    expect(screen.getByText('Re: "DPO missing"')).toBeInTheDocument();
  });

  it("calls onClear when the cross is clicked", () => {
    const onClear = vi.fn();
    render(<ChipBar title="DPO missing" onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove reference" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
