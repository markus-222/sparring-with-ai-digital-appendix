"use client";

import { useState } from "react";

export interface ArtifactEditorProps {
  initial: string;
  onSave(content: string): Promise<void>;
  onCancel(): void;
  saving: boolean;
  error: string | null;
}

/** Plain Markdown text field with [Save] / [Cancel]. Markers are shown as plain text. */
export function ArtifactEditor({ initial, onSave, onCancel, saving, error }: ArtifactEditorProps) {
  const [text, setText] = useState(initial);

  return (
    <div className="flex flex-col gap-3 h-full">
      <textarea
        aria-label="Markdown"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-[300px] w-full resize-none rounded-lg border border-panel bg-white p-3 font-mono text-xs leading-relaxed text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {error !== null && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave(text)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-brand hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-panel text-text-secondary hover:bg-input-bg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
