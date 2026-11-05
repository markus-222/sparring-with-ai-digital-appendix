import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPanel, type OverviewPanelProps } from "@/components/overview/OverviewPanel";
import { makeArtifact } from "@/test/msw-server";
import type { Document } from "@/types";

const DOCS: Document[] = [
  { id: "d1", project_id: "p", filename: "interview.md", content_type: "text/markdown", size_bytes: 10, created_at: "2026-06-01T10:00:00Z" },
  { id: "d2", project_id: "p", filename: "spec.pdf", content_type: "application/pdf", size_bytes: 20, created_at: "2026-06-01T10:00:00Z" },
];

function props(overrides: Partial<OverviewPanelProps> = {}): OverviewPanelProps {
  return {
    documents: DOCS,
    artifacts: [
      makeArtifact("03"),
      makeArtifact("01", { status: "approved" }),
      makeArtifact("02", { status: "draft" }),
    ],
    onOpenArtifact: vi.fn(),
    onOpenDocument: vi.fn(),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onDeleteDocument: vi.fn(),
    ...overrides,
  };
}

describe("OverviewPanel", () => {
  it("lists the three artifacts in slot order with their status", () => {
    render(<OverviewPanel {...props()} />);
    const rows = screen.getAllByTestId("artifact-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("01 Problem- and Scope-Definition")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Approved")).toBeInTheDocument();
    expect(within(rows[1]).getByText("02 Stakeholder Analysis")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Draft")).toBeInTheDocument();
    expect(within(rows[2]).getByText("03 Open Issues & Workshop Questions")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not started")).toBeInTheDocument();
  });

  it("opens an artifact on click", () => {
    const p = props();
    render(<OverviewPanel {...p} />);
    fireEvent.click(screen.getByText("02 Stakeholder Analysis"));
    expect(p.onOpenArtifact).toHaveBeenCalledWith("art-02");
  });

  it("greys out a not started artifact and does not open it", () => {
    const p = props();
    render(<OverviewPanel {...p} />);
    const rows = screen.getAllByTestId("artifact-row");
    expect(rows[0]).toBeEnabled();
    expect(rows[1]).toBeEnabled();
    expect(rows[2]).toBeDisabled();
    fireEvent.click(screen.getByText("03 Open Issues & Workshop Questions"));
    expect(p.onOpenArtifact).not.toHaveBeenCalled();
  });

  it("lists documents and opens one on click", () => {
    const p = props();
    render(<OverviewPanel {...p} />);
    expect(screen.getByText("CUSTOMER DOCUMENTS")).toBeInTheDocument();
    expect(screen.getByText("ARTIFACTS")).toBeInTheDocument();
    fireEvent.click(screen.getByText("spec.pdf"));
    expect(p.onOpenDocument).toHaveBeenCalledWith("d2");
  });

  it("shows an empty hint without documents", () => {
    render(<OverviewPanel {...props({ documents: [] })} />);
    expect(screen.getByText("No documents uploaded yet")).toBeInTheDocument();
  });

  it("uploads through the file input", async () => {
    const p = props();
    const { container } = render(<OverviewPanel {...p} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["hello"], "new.txt", { type: "text/plain" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(p.onUpload).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(p.onUpload).mock.calls[0][0];
    expect(arg).toHaveLength(1);
    expect(arg[0].name).toBe("new.txt");
    expect(await screen.findByText("File uploaded successfully")).toBeInTheDocument();
  });

  it("uploads dropped files", async () => {
    const p = props();
    render(<OverviewPanel {...p} />);
    const zone = screen.getByRole("button", { name: /upload file/i });
    const file = new File(["x"], "drop.md", { type: "text/markdown" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(p.onUpload).toHaveBeenCalledTimes(1));
  });

  it("shows the error when the upload fails", async () => {
    const p = props({ onUpload: vi.fn().mockRejectedValue(new Error("File too large")) });
    const { container } = render(<OverviewPanel {...p} />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "big.pdf", { type: "application/pdf" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    expect(await screen.findByText("File too large")).toBeInTheDocument();
  });

  it("deletes a document without opening it", () => {
    const p = props();
    render(<OverviewPanel {...p} />);
    fireEvent.click(screen.getAllByTitle("Delete")[0]);
    expect(p.onDeleteDocument).toHaveBeenCalledWith("d1");
    expect(p.onOpenDocument).not.toHaveBeenCalled();
  });

  it("lists free-form artifacts (no slot) in their own section and opens them", () => {
    const free = {
      id: "art-free",
      project_id: "p",
      type: "free_abc123",
      title: "Meeting notes",
      content: "# Notes",
      language: null,
      status: "draft" as const,
      reviewed_since_change: false,
      slot: null,
      created_at: "2026-06-01T10:00:00Z",
      updated_at: "2026-06-01T10:00:00Z",
      metadata: null,
    };
    const p = props({ artifacts: [makeArtifact("01"), free] });
    render(<OverviewPanel {...p} />);
    expect(screen.getByText("OTHER ARTIFACTS")).toBeInTheDocument();
    const rows = screen.getAllByTestId("free-artifact-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Meeting notes")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Meeting notes"));
    expect(p.onOpenArtifact).toHaveBeenCalledWith("art-free");
  });

  it("shows no 'OTHER ARTIFACTS' section when there are none", () => {
    render(<OverviewPanel {...props()} />);
    expect(screen.queryByText("OTHER ARTIFACTS")).not.toBeInTheDocument();
  });
});
