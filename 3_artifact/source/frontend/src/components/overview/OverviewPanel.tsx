"use client";

import { memo, useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Download,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { StatusBadge } from "@/components/documents/StatusBadge";
import { documentsApi } from "@/lib/api/documents";
import { SLOT_ORDER, artifactForSlot } from "@/lib/artifacts";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import type { Artifact, ArtifactStatus, Document } from "@/types";

export interface OverviewPanelProps {
  documents: Document[];
  artifacts: Artifact[];
  onOpenArtifact: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onUpload: (files: FileList) => Promise<void>;
  onDeleteDocument: (id: string) => void;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

const STATUS_ICON: Record<ArtifactStatus, React.ReactNode> = {
  not_started: <CircleDashed size={16} strokeWidth={1.75} className="text-muted-text" />,
  draft: <CircleDot size={16} strokeWidth={1.75} className="text-yellow-700" />,
  approved: <CheckCircle2 size={16} strokeWidth={1.75} className="text-success" />,
};

/** Right column: customer documents (upload, drag-drop, delete) and the three artifacts. */
export const OverviewPanel = memo(function OverviewPanel({
  documents,
  artifacts,
  onOpenArtifact,
  onOpenDocument,
  onUpload,
  onDeleteDocument,
}: OverviewPanelProps) {
  const [dragging, setDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Artifacts the Analyst created on request (no fixed slot, no structure/format check).
  const freeArtifacts = artifacts.filter((a) => a.slot == null);

  const handleUpload = useCallback(
    async (files: FileList) => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      setUploadStatus("uploading");
      setUploadError(null);
      try {
        await onUpload(files);
        setUploadStatus("success");
        statusTimeoutRef.current = setTimeout(() => setUploadStatus("idle"), 3000);
      } catch (err: unknown) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
        setUploadStatus("error");
        statusTimeoutRef.current = setTimeout(() => setUploadStatus("idle"), 5000);
      }
    },
    [onUpload],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className={PANEL_HEADER_CLASS}>
        <span className="text-xs font-medium text-brand">Overview</span>
      </div>

      {/* Customer documents */}
      <div className="px-4 pt-4 pb-3">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
          CUSTOMER DOCUMENTS
        </p>

        <div
          onClick={() => uploadStatus !== "uploading" && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (uploadStatus !== "uploading") setDragging(true);
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the zone entirely, not when entering a child
            if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
              setDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (uploadStatus !== "uploading" && e.dataTransfer.files.length) {
              void handleUpload(e.dataTransfer.files);
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="Upload file – click or drag files here"
          className="w-full flex flex-col items-center justify-center gap-2 py-5 mb-2 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none"
          style={{
            borderColor: dragging ? "#1E194B" : "rgba(203,191,251,0.6)",
            backgroundColor: dragging ? "#EEF2FF" : "#FAFAFA",
          }}
        >
          {uploadStatus === "uploading" ? (
            <Loader2 size={20} strokeWidth={1.5} className="text-muted-light animate-spin" />
          ) : (
            <Upload
              size={20}
              strokeWidth={1.5}
              style={{ color: dragging ? "#1E194B" : "var(--color-muted-light)" }}
            />
          )}
          <div className="text-center">
            <p
              className="text-xs font-medium transition-colors"
              style={{ color: dragging ? "#1E194B" : "var(--color-text-secondary)" }}
            >
              {dragging ? "Release to upload" : "Drop files here"}
            </p>
            <p className="text-[10px] text-muted-light mt-0.5">
              PDF, DOCX, TXT, MD · or{" "}
              <span className="underline underline-offset-2" style={{ color: "#1E194B" }}>
                browse
              </span>
            </p>
          </div>
        </div>

        {uploadStatus === "success" && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-medium">
            <CheckCircle2 size={12} strokeWidth={2} />
            File uploaded successfully
          </div>
        )}
        {uploadStatus === "error" && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded-md bg-red-50 text-red-600 text-[11px] font-medium">
            <AlertCircle size={12} strokeWidth={2} />
            {uploadError || "Upload failed"}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />

        {documents.length === 0 ? (
          <p className="text-xs text-muted-light text-center py-3">No documents uploaded yet</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onOpenDocument(doc.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onOpenDocument(doc.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg group text-text-secondary transition-colors hover:bg-input-bg cursor-pointer"
              >
                <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 bg-panel text-muted-light tracking-wide">
                  {doc.content_type.split("/").pop()?.toUpperCase() ?? "FILE"}
                </span>
                <span className="text-xs truncate flex-1">{doc.filename}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void documentsApi.download(doc.id, doc.filename);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-light hover:text-brand"
                  title="Download"
                >
                  <Download size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDocument(doc.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-light hover:text-[#9F1239]"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mx-4 my-1 h-px bg-panel" />

      {/* Artifacts in slot order */}
      <div className="px-4 pt-3 pb-4">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
          ARTIFACTS
        </p>
        <div className="flex flex-col gap-0.5">
          {SLOT_ORDER.map((slot) => {
            const artifact = artifactForSlot(artifacts, slot);
            if (!artifact) return null;
            const notStarted = artifact.status === "not_started";
            return (
              <button
                key={artifact.id}
                type="button"
                data-testid="artifact-row"
                disabled={notStarted}
                title={notStarted ? "Not started yet. Ask the Analyst in the chat to create it." : undefined}
                onClick={() => onOpenArtifact(artifact.id)}
                className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors enabled:hover:bg-input-bg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="shrink-0 flex items-center">
                  {STATUS_ICON[artifact.status]}
                </span>
                <span className="text-xs truncate flex-1 text-text-secondary">
                  {`${slot} ${artifact.title}`}
                </span>
                <StatusBadge status={artifact.status} />
              </button>
            );
          })}
        </div>
      </div>

      {freeArtifacts.length > 0 && (
        <>
          <div className="mx-4 my-1 h-px bg-panel" />
          <div className="px-4 pt-3 pb-4">
            <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
              OTHER ARTIFACTS
            </p>
            <div className="flex flex-col gap-0.5">
              {freeArtifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  data-testid="free-artifact-row"
                  onClick={() => onOpenArtifact(artifact.id)}
                  className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors hover:bg-input-bg"
                >
                  <span aria-hidden="true" className="shrink-0 flex items-center">
                    {STATUS_ICON[artifact.status]}
                  </span>
                  <span className="text-xs truncate flex-1 text-text-secondary">
                    {artifact.title}
                  </span>
                  <StatusBadge status={artifact.status} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

