"use client";

import { AlertCircle } from "lucide-react";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-red-50">
          <AlertCircle size={22} className="text-red-500" />
        </div>
        <h2 className="text-sm font-semibold text-brand">
          Something went wrong
        </h2>
        <p className="text-xs text-muted-text">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-brand text-white hover:bg-accent-grape transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
