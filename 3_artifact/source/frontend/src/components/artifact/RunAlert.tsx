"use client";

import { AlertCircle } from "lucide-react";
import type { Run } from "@/types";

export interface RunAlertProps {
  failed: Run | null;
  /** Message of a rejected start, shown when no run failed. */
  error?: string | null;
  /** Restarts the failed run (same type and slot). */
  onRetry: () => void;
}

/** Chat notice for a failed run (with retry) or a rejected run start. */
export function RunAlert({ failed, error = null, onRetry }: RunAlertProps) {
  if (failed !== null) {
    return (
      <div role="alert" className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
        <AlertCircle size={14} className="text-red-500 shrink-0" />
        <p className="text-xs text-red-700 flex-1">Something went wrong.</p>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-brand hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div role="alert" className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
        <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
        <p className="text-xs text-red-700 flex-1 leading-relaxed">{error}</p>
      </div>
    );
  }

  return null;
}
