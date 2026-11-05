import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickReplies } from "@/components/chat/QuickReplies";

describe("QuickReplies", () => {
  it("sends Yes and No", () => {
    const onReply = vi.fn();
    render(<QuickReplies onReply={onReply} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onReply).toHaveBeenNthCalledWith(1, "Yes");
    expect(onReply).toHaveBeenNthCalledWith(2, "No");
  });

  it("disables both buttons when disabled", () => {
    const onReply = vi.fn();
    render(<QuickReplies onReply={onReply} disabled />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
  });
});
