import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApproveDialog, type ApproveDialogProps } from "@/components/artifact/ApproveDialog";

const BASIS = "It becomes the confirmed basis for the next artifacts.";
const NOT_REVIEWED = "Not reviewed yet";
const NOT_REVIEWED_BASIS =
  "Approving now skips review. Approved drafts become the confirmed basis for the next artifacts.";

function props(overrides: Partial<ApproveDialogProps> = {}): ApproveDialogProps {
  return {
    open: true,
    reviewed: true,
    onReviewFirst: vi.fn(),
    onApprove: vi.fn(),
    onClose: vi.fn(),
    busy: false,
    error: null,
    ...overrides,
  };
}

describe("ApproveDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ApproveDialog {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reviewed: offers only Approve and states the basis sentence", () => {
    render(<ApproveDialog {...props()} />);
    expect(screen.getByText(BASIS)).toBeInTheDocument();
    expect(screen.queryByText(NOT_REVIEWED)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review first" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve anyway" })).not.toBeInTheDocument();
  });

  it("reviewed: Approve calls onApprove(false)", () => {
    const p = props();
    render(<ApproveDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledWith(false);
  });

  it("not reviewed: shows the warning with Review first and Approve anyway", () => {
    render(<ApproveDialog {...props({ reviewed: false })} />);
    expect(screen.getByText(NOT_REVIEWED)).toBeInTheDocument();
    expect(screen.getByText(NOT_REVIEWED_BASIS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review first" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve anyway" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("not reviewed: Review first calls onReviewFirst", () => {
    const p = props({ reviewed: false });
    render(<ApproveDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Review first" }));
    expect(p.onReviewFirst).toHaveBeenCalledTimes(1);
    expect(p.onApprove).not.toHaveBeenCalled();
  });

  it("not reviewed: Approve anyway calls onApprove(true)", () => {
    const p = props({ reviewed: false });
    render(<ApproveDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
    expect(p.onApprove).toHaveBeenCalledWith(true);
  });

  it("Close calls onClose", () => {
    const p = props();
    render(<ApproveDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons while busy", () => {
    const p = props({ reviewed: false, busy: true });
    render(<ApproveDialog {...p} />);
    expect(screen.getByRole("button", { name: "Review first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve anyway" })).toBeDisabled();
  });

  it("shows the error message", () => {
    render(<ApproveDialog {...props({ error: "Resolve all open comments first." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Resolve all open comments first.");
  });
});
