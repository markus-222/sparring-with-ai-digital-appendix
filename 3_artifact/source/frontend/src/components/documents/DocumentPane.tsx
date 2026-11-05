"use client";

import { memo } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { DocumentViewer } from "@/components/documents/DocumentViewer";
import { useDocumentPreview } from "@/hooks/useDocumentPreview";
import { documentsApi } from "@/lib/api/documents";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import type { Artifact, Document, Source } from "@/types";

interface DocumentPaneProps {
  document: Document;
  documents: Document[];
  artifacts: Artifact[];
  onBack: () => void;
  onOpenSource: (source: Source) => void;
}

/** Right-column viewer for one customer document (view, download, back to the overview). */
export const DocumentPane = memo(function DocumentPane({
  document: doc,
  documents,
  artifacts,
  onBack,
  onOpenSource,
}: DocumentPaneProps) {
  const { url, text, loading, error } = useDocumentPreview(doc);

  return (
    <div className="flex flex-col h-full">
      <div className={PANEL_HEADER_CLASS}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to overview"
          className="flex items-center gap-1 text-xs text-muted-light transition-colors hover:text-brand"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          Overview
        </button>
        <button
          type="button"
          onClick={() => void documentsApi.download(doc.id, doc.filename)}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-panel text-xs font-medium text-text-secondary transition-colors hover:bg-input-bg hover:text-brand"
        >
          <Download size={12} strokeWidth={1.75} />
          Download
        </button>
      </div>

      <div className="px-6 pt-5 pb-3 shrink-0">
        <h2 className="text-sm font-semibold text-brand">{doc.filename}</h2>
      </div>

      <div className="flex-1 min-h-0 pb-4">
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
      </div>
    </div>
  );
});
