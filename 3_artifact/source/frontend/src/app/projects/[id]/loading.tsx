import { Loader2 } from "lucide-react";

export default function ProjectLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-brand" />
        <p className="text-xs text-muted-text">Loading project…</p>
      </div>
    </div>
  );
}
