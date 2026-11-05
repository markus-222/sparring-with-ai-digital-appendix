import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactToolbar, type ArtifactToolbarProps } from "@/components/artifact/ArtifactToolbar";
import { makeArtifact } from "@/test/msw-server";

const RUN_REASON = "A run is active. Please wait until it has finished.";

function props(overrides: Partial<ArtifactToolbarProps> = {}): ArtifactToolbarProps {
  return {
    artifact: makeArtifact("01", { status: "draft", content: "# Text" }),
    openComments: 0,
    locks: { runLocked: false, editorLocked: false },
    onRequestReview: vi.fn(),
    onApprove: vi.fn(),
    onEdit: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("ArtifactToolbar", () => {
  it("renders no buttons for a not started artifact", () => {
    render(<ArtifactToolbar {...props({ artifact: makeArtifact("01") })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("does not offer Create draft for a draft", () => {
    render(<ArtifactToolbar {...props()} />);
    expect(screen.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("hides Request review for a free-form artifact (no slot), but still allows Approve", () => {
    const freeArtifact = { ...makeArtifact("01", { status: "draft", content: "# Text" }), slot: null };
    render(<ArtifactToolbar {...props({ artifact: freeArtifact })} />);
    expect(screen.queryByRole("button", { name: "Request review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("calls the handlers of the enabled buttons", () => {
    const p = props();
    render(<ArtifactToolbar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(p.onRequestReview).toHaveBeenCalledTimes(1);
    expect(p.onApprove).toHaveBeenCalledTimes(1);
    expect(p.onEdit).toHaveBeenCalledTimes(1);
  });

  it("disables Request review and Approve with open comments and explains why", () => {
    const p = props({ openComments: 2 });
    render(<ArtifactToolbar {...p} />);
    for (const name of ["Request review", "Approve"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", "Resolve all open comments first.");
    }
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));
    expect(p.onRequestReview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("disables everything during a run with the run reason", () => {
    render(<ArtifactToolbar {...props({ locks: { runLocked: true, editorLocked: false } })} />);
    for (const name of ["Request review", "Approve", "Edit"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", RUN_REASON);
    }
  });

  it("disables everything while the editor is open", () => {
    render(<ArtifactToolbar {...props({ locks: { runLocked: false, editorLocked: true } })} />);
    for (const name of ["Request review", "Approve", "Edit"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("title", "Please save or cancel your edits first.");
    }
  });

  it("disables Request review and Approve for an empty draft", () => {
    render(<ArtifactToolbar {...props({ artifact: makeArtifact("01", { status: "draft", content: "" }) })} />);
    expect(screen.getByRole("button", { name: "Request review" })).toHaveAttribute("title", "The draft is empty.");
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAttribute("title", "The draft is empty.");
  });

  it("offers only Edit for an approved artifact", () => {
    render(<ArtifactToolbar {...props({ artifact: makeArtifact("01", { status: "approved", content: "# Text" }) })} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Request review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument();
  });

  it("hides Edit and Approve while no handler is wired", () => {
    render(<ArtifactToolbar {...props({ onEdit: undefined, onApprove: undefined })} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request review" })).toBeEnabled();
  });

  it("offers Download and Delete for a draft and an approved artifact", () => {
    const p = props({ artifact: makeArtifact("01", { status: "approved", content: "# Text" }) });
    render(<ArtifactToolbar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(p.onDownload).toHaveBeenCalledTimes(1);
    expect(p.onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps Download available during a run but disables Delete with the run reason", () => {
    render(<ArtifactToolbar {...props({ locks: { runLocked: true, editorLocked: false } })} />);
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", RUN_REASON);
  });

  it("compact mode shows icons only but keeps accessible names and tooltips", () => {
    const p = props();
    render(<ArtifactToolbar {...p} compact />);
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toHaveTextContent("");
    expect(edit).toHaveAttribute("title", "Edit");
    fireEvent.click(edit);
    expect(p.onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Download" })).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Approve" })).toHaveTextContent("");
  });

  it("hides Download and Delete while no handler is wired", () => {
    render(<ArtifactToolbar {...props({ onDownload: undefined, onDelete: undefined })} />);
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
