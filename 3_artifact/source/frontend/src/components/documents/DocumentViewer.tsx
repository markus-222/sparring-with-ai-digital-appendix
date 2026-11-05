"use client";

import { Download, Loader2, AlertCircle, FileWarning } from "lucide-react";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import type { Document, Artifact, Source } from "@/types";

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface DocumentViewerProps {
  contentType: string;
  url: string | null;
  text: string | null;
  loading: boolean;
  error: string | null;
  onDownload: () => void;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
}

export function DocumentViewer({
  contentType,
  url,
  text,
  loading,
  error,
  onDownload,
  documents,
  artifacts,
  onOpenSource,
}: DocumentViewerProps) {
  const isText = contentType.startsWith("text/plain");
  const isMarkdown = contentType.startsWith("text/markdown");
  const isPdf = contentType.startsWith("application/pdf");
  const isDocx = contentType.startsWith(DOCX_CONTENT_TYPE);

  if (isDocx) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-6">
        <FileWarning size={28} strokeWidth={1.5} className="text-muted-light" />
        <p className="text-xs text-muted-light max-w-[220px]">
          Preview not available for Word documents.
        </p>
        <button
          onClick={onDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
          style={{ backgroundColor: "#1E194B" }}
        >
          <Download size={12} /> Download to view
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" className="flex items-center justify-center h-full">
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-muted-light" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-1.5 justify-center h-full text-red-600 text-xs">
        <AlertCircle size={14} /> {error}
      </div>
    );
  }

  if (isPdf && url) {
    return <embed src={url} type="application/pdf" className="w-full h-full" />;
  }

  if (isMarkdown) {
    return (
      <div className="px-6 py-4 overflow-y-auto h-full">
        <MarkdownRenderer
          content={text ?? ""}
          documents={documents}
          artifacts={artifacts}
          onOpenSource={onOpenSource}
        />
      </div>
    );
  }

  if (isText) {
    return (
      <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-prose-text px-6 py-4 overflow-y-auto h-full">
        {text ?? ""}
      </pre>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-light">
      Preview not available for this file type.
    </div>
  );
}
