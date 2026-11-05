"use client";

import { Paperclip, X } from "lucide-react";

export interface ChipBarProps {
  title: string;
  onClear(): void;
}

/** The chip above the chat input: the comment the next messages refer to. */
export function ChipBar({ title, onClear }: ChipBarProps) {
  return (
    <div className="mx-5 mb-1 max-w-2xl self-stretch flex items-center gap-1.5 text-[11px] text-text-secondary">
      <Paperclip size={11} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{`Re: "${title}"`}</span>
      <button
        type="button"
        aria-label="Remove reference"
        onClick={onClear}
        className="shrink-0 text-muted-light hover:text-brand"
      >
        <X size={11} />
      </button>
    </div>
  );
}
