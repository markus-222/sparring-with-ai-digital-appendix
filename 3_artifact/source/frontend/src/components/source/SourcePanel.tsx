"use client";

import { memo } from "react";
import { Loader2, X } from "lucide-react";
import { DocumentViewer } from "@/components/documents/DocumentViewer";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import { useDocumentPreview } from "@/hooks/useDocumentPreview";
import { documentsApi } from "@/lib/api/documents";
import { ApiError } from "@/lib/api/errors";
import { useApprovedVersion } from "@/lib/api/hooks";
import { artifactForSlot } from "@/lib/artifacts";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import type { Artifact, Document, Slot, Source } from "@/types";

export interface SourcePanelProps {
  source: Source;
  documents: Document[];
  artifacts: Artifact[];
  onClose(): void;
  /** A citation inside the shown source was clicked; it replaces the current source. */
  onOpenSource?: (source: Source) => void;
}

const NO_APPROVED_VERSION = "No approved version yet.";

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside aria-label="Source" className="flex flex-col h-full bg-white">
      <div className={PANEL_HEADER_CLASS}>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-brand">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close source"
          className="shrink-0 rounded-lg p-1 text-muted-light transition-colors hover:bg-input-bg hover:text-brand"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </aside>
  );
}

function DocumentSource({
  doc,
  documents,
  artifacts,
  onClose,
  onOpenSource,
}: {
  doc: Document;
  documents: Document[];
  artifacts: Artifact[];
  onClose: () => void;
  onOpenSource?: (source: Source) => void;
}) {
  const { url, text, loading, error } = useDocumentPreview(doc);
  return (
    <PanelShell title={doc.filename} onClose={onClose}>
      <DocumentViewer
        contentType={doc.content_type}
        url={url}
        text={text}
        loading={loading}
        error={error}
        onDownload={() => void documentsApi.download(doc.id, doc.filename)}
        documents={documents}
        artifacts={artifacts}
        onOpenSource={onOpenSource}
      />
    </PanelShell>
  );
}

function ArtifactSource({
  slot,
  documents,
  artifacts,
  onClose,
  onOpenSource,
}: {
  slot: Slot;
  documents: Document[];
  artifacts: Artifact[];
  onClose: () => void;
  onOpenSource?: (source: Source) => void;
}) {
  const artifact = artifactForSlot(artifacts, slot);
  const { data, error, isLoading } = useApprovedVersion(artifact?.id ?? null);
  const base = artifact ? `${slot} · ${artifact.title}` : slot;
  const title = data ? `${base} · v${data.version_no}` : base;
  const missing =
    artifact === null || (error instanceof ApiError && error.status === 404) ? NO_APPROVED_VERSION : null;

  return (
    <PanelShell title={title} onClose={onClose}>
      {data ? (
        <div className="px-6 py-4">
          <MarkdownRenderer
            markers
            content={data.content}
            documents={documents}
            artifacts={artifacts}
            onOpenSource={onOpenSource}
          />
        </div>
      ) : missing !== null ? (
        <p className="px-6 py-4 text-xs text-muted-light">{missing}</p>
      ) : error ? (
        <p role="alert" className="px-6 py-4 text-xs text-red-600">
          {error.message}
        </p>
      ) : isLoading ? (
        <div role="status" className="flex items-center justify-center h-full">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-muted-light" />
        </div>
      ) : null}
    </PanelShell>
  );
}

/**
 * Read-only side panel over the comments column: a customer document, or the last approved
 * version of an artifact (never the current draft). Closed with the X button.
 */
export const SourcePanel = memo(function SourcePanel({ source, documents, artifacts, onClose, onOpenSource }: SourcePanelProps) {
  if (source.kind === "artifact") {
    return (
      <ArtifactSource
        slot={source.slot}
        documents={documents}
        artifacts={artifacts}
        onClose={onClose}
        onOpenSource={onOpenSource}
      />
    );
  }
  const doc = documents.find((d) => d.id === source.documentId) ?? null;
  if (doc === null) {
    return (
      <PanelShell title="Document" onClose={onClose}>
        <p className="px-6 py-4 text-xs text-muted-light">Document not available.</p>
      </PanelShell>
    );
  }
  return (
    <DocumentSource
      doc={doc}
      documents={documents}
      artifacts={artifacts}
      onClose={onClose}
      onOpenSource={onOpenSource}
    />
  );
});
