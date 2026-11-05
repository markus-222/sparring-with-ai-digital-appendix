"use client";

import type { LucideIcon } from "lucide-react";
import { Download, MessageSquareText, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import {
  approveReason,
  deleteReason,
  editReason,
  reviewReason,
  type LockState,
  type ReasonContext,
} from "@/lib/artifacts";
import type { Artifact } from "@/types";

export interface ArtifactToolbarProps {
  artifact: Artifact;
  openComments: number;
  locks: LockState;
  onRequestReview(): void;
  /** Buttons without a handler are not rendered (the approve dialog and editor arrive in a later task). */
  onApprove?(): void;
  onEdit?(): void;
  onDownload?(): void;
  /** Starts over: the artifact goes back to "not started". */
  onDelete?(): void;
  /** Icon-only buttons (label moves into tooltip + aria-label), for when the row is squeezed. */
  compact?: boolean;
}

interface ToolbarButtonProps {
  label: string;
  icon: LucideIcon;
  reason: string | null;
  onClick(): void;
  variant?: "default" | "accent" | "primary";
  compact: boolean;
}

function ToolbarButton({ label, icon: Icon, reason, onClick, variant = "default", compact }: ToolbarButtonProps) {
  const disabled = reason !== null;
  const style =
    variant === "primary"
      ? "text-white bg-brand hover:opacity-90"
      : variant === "accent"
        ? "border border-brand text-brand hover:bg-brand/5"
        : "border border-panel text-text-secondary hover:bg-input-bg";
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      title={reason ?? (compact ? label : undefined)}
      aria-label={compact ? label : undefined}
      onClick={onClick}
      className={`shrink-0 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        compact ? "p-2" : "px-3 py-1.5"
      } ${style}`}
    >
      <Icon size={compact ? 14 : 12} strokeWidth={1.75} />
      {!compact && label}
    </button>
  );
}

/** Action buttons of an open artifact; a disabled button explains why in its tooltip. */
export function ArtifactToolbar({
  artifact,
  openComments,
  locks,
  onRequestReview,
  onApprove,
  onEdit,
  onDownload,
  onDelete,
  compact = false,
}: ArtifactToolbarProps) {
  const ctx: ReasonContext = { artifact, openComments, locks };

  // Artifacts are only created through the chat, so a not-started one has no actions.
  if (artifact.status === "not_started") return null;

  return (
    <div className="flex items-center gap-2">
      {onEdit && <ToolbarButton label="Edit" icon={Pencil} reason={editReason(ctx)} onClick={onEdit} compact={compact} />}
      {onDownload && <ToolbarButton label="Download" icon={Download} reason={null} onClick={onDownload} compact={compact} />}
      {onDelete && <ToolbarButton label="Delete" icon={Trash2} reason={deleteReason(ctx)} onClick={onDelete} compact={compact} />}
      <div className="flex-1" />
      {artifact.status === "draft" && artifact.slot !== null && (
        <ToolbarButton label="Request review" icon={MessageSquareText} reason={reviewReason(ctx)} onClick={onRequestReview} variant="primary" compact={compact} />
      )}
      {artifact.status === "draft" && onApprove && (
        <ToolbarButton label="Approve" icon={ShieldCheck} reason={approveReason(ctx)} onClick={onApprove} variant="accent" compact={compact} />
      )}
    </div>
  );
}
