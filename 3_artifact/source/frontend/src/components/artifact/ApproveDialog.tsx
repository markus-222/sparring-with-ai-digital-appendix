"use client";

import { MessageSquareText, ShieldCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface ApproveDialogProps {
  open: boolean;
  /** `reviewed_since_change` of the artifact. */
  reviewed: boolean;
  onReviewFirst(): void;
  onApprove(force: boolean): void;
  onClose(): void;
  busy: boolean;
  error: string | null;
}

const primary =
  "px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-brand hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const textButton =
  "inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-brand hover:text-brand/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Approve confirmation; without a review since the last change it offers review first or force. */
export function ApproveDialog({ open, reviewed, onReviewFirst, onApprove, onClose, busy, error }: ApproveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent role="dialog" aria-modal="true" aria-label="Approve artifact" className="relative max-w-sm p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 p-1 rounded-lg hover:bg-input-bg transition-colors"
        >
          <X size={16} className="text-text-secondary" />
        </button>
        <DialogHeader className="space-y-1.5 pr-6 text-left">
          <DialogTitle className="text-sm">
            {reviewed ? "Approve this artifact?" : "Not reviewed yet"}
          </DialogTitle>
          <p className="text-xs leading-relaxed text-text-secondary">
            {reviewed
              ? "It becomes the confirmed basis for the next artifacts."
              : "Approving now skips review. Approved drafts become the confirmed basis for the next artifacts."}
          </p>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}
        <DialogFooter className="mt-6 items-center gap-3">
          {!reviewed && (
            <button type="button" className={textButton} disabled={busy} onClick={() => onApprove(true)}>
              <ShieldCheck size={14} className="text-brand" aria-hidden="true" />
              Approve anyway
            </button>
          )}
          <button
            type="button"
            className={`${primary} inline-flex items-center gap-1.5`}
            disabled={busy}
            onClick={reviewed ? () => onApprove(false) : onReviewFirst}
          >
            {reviewed ? (
              <ShieldCheck size={14} aria-hidden="true" />
            ) : (
              <MessageSquareText size={14} aria-hidden="true" />
            )}
            {reviewed ? "Approve" : "Review first"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
