"use client";

interface QuickRepliesProps {
  onReply: (text: "Yes" | "No") => void;
  disabled?: boolean;
}

/** Yes/No buttons for a pending confirmation (F3). */
export function QuickReplies({ onReply, disabled = false }: QuickRepliesProps) {
  const base =
    "text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div data-testid="quick-replies" className="flex items-center gap-2 pl-10">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onReply("Yes")}
        className={`${base} border-brand bg-brand text-white hover:opacity-90`}
      >
        Yes
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onReply("No")}
        className={`${base} border-accent-grape-border bg-white text-brand hover:bg-brand-light`}
      >
        No
      </button>
    </div>
  );
}
