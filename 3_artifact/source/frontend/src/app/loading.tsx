import { Loader2 } from "lucide-react";

export default function GlobalLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-brand" />
        <p className="text-xs text-muted-text">Loading…</p>
      </div>
    </div>
  );
}
