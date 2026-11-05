import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { DocumentViewer, DOCX_CONTENT_TYPE } from "@/components/documents/DocumentViewer";

describe("DocumentViewer", () => {
  test("zeigt Ladeindikator während loading=true", () => {
    render(
      <DocumentViewer
        contentType="text/plain"
        url={null}
        text={null}
        loading={true}
        error={null}
        onDownload={() => {}}
      />
    );
    expect(screen.getByRole("status", { hidden: true })).toBeTruthy;
  });

  test("zeigt Fehlermeldung bei error", () => {
    render(
      <DocumentViewer
        contentType="text/plain"
        url={null}
        text={null}
        loading={false}
        error="View failed: 500"
        onDownload={() => {}}
      />
    );
    expect(screen.getByText("View failed: 500")).toBeInTheDocument();
  });

  test("rendert Markdown-Inhalt über MarkdownRenderer", async () => {
    render(
      <DocumentViewer
        contentType="text/markdown"
        url="blob:markdown"
        text="# Hello Requirements"
        loading={false}
        error={null}
        onDownload={() => {}}
      />
    );
    expect(await screen.findByRole("heading", { name: "Hello Requirements" })).toBeInTheDocument();
  });

  test("rendert Klartext in einem <pre>-Block", () => {
    render(
      <DocumentViewer
        contentType="text/plain; charset=utf-8"
        url="blob:text"
        text="Plain content line"
        loading={false}
        error={null}
        onDownload={() => {}}
      />
    );
    expect(screen.getByText("Plain content line")).toBeInTheDocument();
  });

  test("rendert PDF über <embed> mit korrekter src", () => {
    const { container } = render(
      <DocumentViewer
        contentType="application/pdf"
        url="blob:pdf-content"
        text={null}
        loading={false}
        error={null}
        onDownload={() => {}}
      />
    );
    const embed = container.querySelector("embed");
    expect(embed).not.toBeNull();
    expect(embed?.getAttribute("src")).toBe("blob:pdf-content");
    expect(embed?.getAttribute("type")).toBe("application/pdf");
  });

  test("zeigt Fallback-Hinweis für DOCX statt eines Previews", () => {
    render(
      <DocumentViewer
        contentType={DOCX_CONTENT_TYPE}
        url={null}
        text={null}
        loading={false}
        error={null}
        onDownload={() => {}}
      />
    );
    expect(screen.getByText(/preview not available for word documents/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download to view/i })).toBeInTheDocument();
  });
});
