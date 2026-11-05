import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { SourcePanel } from "@/components/source/SourcePanel";
import { documentsApi } from "@/lib/api/documents";
import { ARTIFACTS, PROJECT_ID, server } from "@/test/msw-server";
import type { Document, Source } from "@/types";

const BASE = "http://localhost:8000/api/v1";

const PDF_DOC: Document = {
  id: "doc-1",
  project_id: PROJECT_ID,
  filename: "a.pdf",
  content_type: "application/pdf",
  size_bytes: 10,
  created_at: "2026-06-01T10:00:00Z",
};

const MD_DOC: Document = { ...PDF_DOC, id: "doc-2", filename: "a.md", content_type: "text/markdown" };

function approvedVersion(content: string, versionNo: number) {
  return { artifact_id: "art-01", version_no: versionNo, content, created_at: "2026-06-02T10:00:00Z" };
}

function mount(source: Source, overrides: { onClose?: () => void; onOpenSource?: (s: Source) => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SourcePanel
        source={source}
        documents={[PDF_DOC, MD_DOC]}
        artifacts={ARTIFACTS}
        onClose={onClose}
        onOpenSource={overrides.onOpenSource}
      />
    </SWRConfig>,
  );
  return { ...view, onClose };
}

describe("SourcePanel", () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the document viewer for a document source", async () => {
    vi.spyOn(documentsApi, "view").mockResolvedValue({ url: "blob:pdf-content", contentType: "application/pdf" });
    const { container } = mount({ kind: "document", documentId: "doc-1" });
    expect(screen.getByRole("heading", { name: "a.pdf" })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("embed")).not.toBeNull());
    expect(container.querySelector("embed")?.getAttribute("src")).toBe("blob:pdf-content");
  });

  it("fetches the last approved version of an artifact and shows text and version number", async () => {
    server.use(
      http.get(`${BASE}/artifacts/art-01/approved-version`, () =>
        HttpResponse.json(approvedVersion("# Approved goals\n\nBuild the thing.", 2)),
      ),
    );
    mount({ kind: "artifact", slot: "01" });
    expect(screen.getByRole("heading", { name: "01 · Problem- and Scope-Definition" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "01 · Problem- and Scope-Definition · v2" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Approved goals" })).toBeInTheDocument();
    expect(await screen.findByText("Build the thing.")).toBeInTheDocument();
  });

  it("shows v1 for a first approval", async () => {
    server.use(
      http.get(`${BASE}/artifacts/art-02/approved-version`, () =>
        HttpResponse.json({ ...approvedVersion("Stakeholders", 1), artifact_id: "art-02" }),
      ),
    );
    mount({ kind: "artifact", slot: "02" });
    expect(await screen.findByText(/02 · Stakeholder Analysis · v1/)).toBeInTheDocument();
    expect(await screen.findByText("Stakeholders")).toBeInTheDocument();
  });

  it("shows 'No approved version yet.' on a 404", async () => {
    server.use(
      http.get(`${BASE}/artifacts/art-03/approved-version`, () =>
        HttpResponse.json({ detail: "No approved version" }, { status: 404 }),
      ),
    );
    mount({ kind: "artifact", slot: "03" });
    expect(await screen.findByText("No approved version yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^03 · Open Issues/ })).toBeInTheDocument();
  });

  it("calls onClose from the close button", async () => {
    vi.spyOn(documentsApi, "view").mockResolvedValue({ url: "blob:pdf-content", contentType: "application/pdf" });
    const { onClose, container } = mount({ kind: "document", documentId: "doc-1" });
    await waitFor(() => expect(container.querySelector("embed")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Close source" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens a citation inside the approved version as a source", async () => {
    server.use(
      http.get(`${BASE}/artifacts/art-01/approved-version`, () =>
        HttpResponse.json(approvedVersion("Based on [[doc:a.md]] and [[artifact:02]].", 1)),
      ),
    );
    const onOpenSource = vi.fn();
    mount({ kind: "artifact", slot: "01" }, { onOpenSource });
    const docButton = await screen.findByRole("button", { name: "a.md" });
    fireEvent.click(docButton);
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "doc-2" });
    fireEvent.click(screen.getByRole("button", { name: "02 · Stakeholder Analysis" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "artifact", slot: "02" });
  });
});

describe("artifact and document citations", () => {
  it("[[artifact:01]] opens the artifact of that slot", () => {
    const onOpenSource = vi.fn();
    render(<AgentMarkdown content="See [[artifact:01]]." artifacts={ARTIFACTS} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole("button", { name: "01 · Problem- and Scope-Definition" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "artifact", slot: "01" });
  });

  it("resolves 02 and 03 by slot, not by id", () => {
    const onOpenSource = vi.fn();
    render(<AgentMarkdown content="[[artifact:02]] [[artifact:03]]" artifacts={ARTIFACTS} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole("button", { name: "03 · Open Issues & Workshop Questions" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "artifact", slot: "03" });
    fireEvent.click(screen.getByRole("button", { name: "02 · Stakeholder Analysis" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "artifact", slot: "02" });
  });

  it("renders an unknown slot disabled", () => {
    const onOpenSource = vi.fn();
    render(<AgentMarkdown content="[[artifact:09]]" artifacts={ARTIFACTS} onOpenSource={onOpenSource} />);
    const button = screen.getByRole("button", { name: "Artifact not available" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it("[[doc:a.md]] resolves to the matching document id", () => {
    const onOpenSource = vi.fn();
    render(<AgentMarkdown content="[[doc:a.md]]" documents={[PDF_DOC, MD_DOC]} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole("button", { name: "a.md" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "doc-2" });
  });

  it("renders an unknown filename disabled", () => {
    const onOpenSource = vi.fn();
    render(<AgentMarkdown content="[[doc:missing.md]]" documents={[PDF_DOC, MD_DOC]} onOpenSource={onOpenSource} />);
    const button = screen.getByRole("button", { name: "Document not available" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onOpenSource).not.toHaveBeenCalled();
  });
});
