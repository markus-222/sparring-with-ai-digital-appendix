"use client";

import { starterPromptsFor } from "@/lib/chat/starterPrompts";
import type { Artifact } from "@/types";

interface StarterPromptsProps {
  artifacts: Artifact[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

/** Starter prompts follow the artifact state and are sent immediately on click. */
export function StarterPrompts({ artifacts, onSend, disabled = false }: StarterPromptsProps) {
  return (
    <div className="flex flex-col items-start gap-2 pl-10">
      {starterPromptsFor(artifacts).map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onSend(text)}
          className="text-left text-xs px-3 py-1.5 rounded-full border border-accent-grape-border text-brand bg-white transition-colors hover:bg-brand-light disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
