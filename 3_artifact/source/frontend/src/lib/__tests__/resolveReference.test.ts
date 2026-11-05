import { describe, expect, it } from "vitest";
import {
  extractLocatorSuffix,
  normalizeFilenameCandidate,
  resolveCitation,
  resolveReference,
} from "@/lib/resolveReference";
import type { Artifact, Document } from "@/types";

function doc(id: string, filename: string): Document {
  return {
    id,
    project_id: "p",
    filename,
    content_type: "text/markdown",
    size_bytes: 1,
    created_at: "2026-06-01T10:00:00Z",
  };
}

function artifact(id: string, slot: Artifact["slot"], title: string): Artifact {
  return {
    id,
    project_id: "p",
    type: "t",
    title,
    content: "",
    language: null,
    status: "draft",
    reviewed_since_change: false,
    slot,
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
    metadata: null,
  };
}

const documents = [doc("d1", "interview.md"), doc("d2", "kpi_report.md")];
const artifacts = [artifact("a1", "01", "Project Description"), artifact("a2", null, "Loose Notes")];

describe("normalizeFilenameCandidate", () => {
  it("strips schemes, paths, percent-encoding and locator suffixes", () => {
    expect(normalizeFilenameCandidate("doc://foo.md")).toBe("foo.md");
    expect(normalizeFilenameCandidate("./dir/foo.md")).toBe("foo.md");
    expect(normalizeFilenameCandidate("doc://foo.md%2C%2000%3A53")).toBe("foo.md");
    expect(normalizeFilenameCandidate("foo.md, 00:06–00:10")).toBe("foo.md");
    expect(normalizeFilenameCandidate("artifact://01")).toBe("01");
  });

  it("keeps values with invalid percent-encoding as they are", () => {
    expect(normalizeFilenameCandidate("100%.md")).toBe("100%.md");
  });
});

describe("extractLocatorSuffix", () => {
  it("returns the text after the first comma", () => {
    expect(extractLocatorSuffix("t.md, 00:06–00:10")).toBe("00:06–00:10");
  });

  it("returns null without a comma or with an empty suffix", () => {
    expect(extractLocatorSuffix("t.md")).toBeNull();
    expect(extractLocatorSuffix("t.md,  ")).toBeNull();
  });
});

describe("resolveReference: explicit doc:// and artifact:// links", () => {
  it("resolves a document and appends the locator to the label", () => {
    const text = "interview.md, 00:53";
    const resolved = resolveReference({
      href: `doc://${encodeURIComponent(text)}`,
      text,
      documents,
      artifacts,
    });
    expect(resolved).toEqual({
      kind: "document",
      label: "interview.md (00:53)",
      source: { kind: "document", documentId: "d1" },
    });
  });

  it("labels an unknown document as unavailable and gives it no source", () => {
    expect(resolveReference({ href: "doc://gone.md", text: "gone.md", documents, artifacts })).toEqual({
      kind: "document",
      label: "Document not available",
      source: null,
    });
  });

  it("resolves an artifact by slot", () => {
    expect(resolveReference({ href: "artifact://01", text: "01", documents, artifacts })).toEqual({
      kind: "artifact",
      label: "01 · Project Description",
      source: { kind: "artifact", slot: "01" },
    });
  });

  it("labels an unknown artifact slot as unavailable", () => {
    expect(resolveReference({ href: "artifact://03", text: "03", documents, artifacts })).toEqual({
      kind: "artifact",
      label: "Artifact not available",
      source: null,
    });
  });

  it("does not treat an explicit artifact link as a document, even with a matching name", () => {
    const resolved = resolveReference({ href: "artifact://interview.md", text: "interview.md", documents, artifacts });
    expect(resolved?.kind).toBe("artifact");
    expect(resolved?.source).toBeNull();
  });
});

describe("resolveReference: plain Markdown links", () => {
  it("matches a document by href filename", () => {
    expect(resolveReference({ href: "./interview.md", text: "see this", documents, artifacts })).toEqual({
      kind: "document",
      label: "interview.md",
      source: { kind: "document", documentId: "d1" },
    });
  });

  it("matches a document by visible text and takes the locator from it", () => {
    const resolved = resolveReference({ href: "https://x.invalid", text: "kpi_report.md, p. 3", documents, artifacts });
    expect(resolved?.label).toBe("kpi_report.md (p. 3)");
    expect(resolved?.source).toEqual({ kind: "document", documentId: "d2" });
  });

  it("matches an artifact by title", () => {
    expect(resolveReference({ href: "Project Description", text: "link", documents, artifacts })).toEqual({
      kind: "artifact",
      label: "01 · Project Description",
      source: { kind: "artifact", slot: "01" },
    });
  });

  it("ignores artifacts without a slot", () => {
    expect(resolveReference({ href: "Loose Notes", text: "Loose Notes", documents, artifacts })).toBeNull();
  });

  it("returns null for ordinary external links and without lookup data", () => {
    expect(resolveReference({ href: "https://example.com", text: "Example", documents, artifacts })).toBeNull();
    expect(resolveReference({ href: "interview.md", text: "x" })).toBeNull();
    expect(resolveReference({ text: "" })).toBeNull();
  });
});

describe("resolveCitation (Tiptap node attrs: kind + label)", () => {
  it("resolves a doc citation with its locator", () => {
    expect(resolveCitation({ kind: "doc", label: "interview.md, 00:53", documents, artifacts })).toEqual({
      kind: "document",
      label: "interview.md (00:53)",
      source: { kind: "document", documentId: "d1" },
    });
  });

  it("resolves an artifact citation and reports unknown ones as unavailable", () => {
    expect(resolveCitation({ kind: "artifact", label: "01", documents, artifacts }).source).toEqual({
      kind: "artifact",
      slot: "01",
    });
    expect(resolveCitation({ kind: "artifact", label: "02", documents, artifacts })).toEqual({
      kind: "artifact",
      label: "Artifact not available",
      source: null,
    });
  });

  it("is consistent with resolveReference for the equivalent explicit link", () => {
    const label = "interview.md, 00:53";
    expect(resolveCitation({ kind: "doc", label, documents, artifacts })).toEqual(
      resolveReference({ href: `doc://${encodeURIComponent(label)}`, text: label, documents, artifacts }),
    );
  });
});
