"use client";

import { useEffect, useState, useRef } from "react";
import { Send, FileText, Square } from "lucide-react";
import type { Document } from "@/types";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  documents?: Document[];
  /** Tooltip explaining why the input is disabled, if there is a reason. */
  disabledReason?: string | null;
  /** A reply is streaming: the send button becomes a stop button and Escape stops it. */
  busy?: boolean;
  onStop?: () => void;
  /** Text taken back by Stop; a new object (nonce) refills the input and focuses it. */
  restored?: { text: string; nonce: number } | null;
}

// line-height 1.6 × 15px font-size = 24px per line; 5 lines max
const MAX_LINES = 5;
const LINE_HEIGHT_PX = 24;
const MAX_HEIGHT = MAX_LINES * LINE_HEIGHT_PX;

const NO_DOCUMENTS: Document[] = [];

export function ChatInput({ onSend, disabled, documents = NO_DOCUMENTS, disabledReason, busy = false, onStop, restored = null }: ChatInputProps) {
  const placeholder = "Ask the Analyst…";
  const [input, setInput] = useState("");
  const [mention, setMention] = useState<{ open: boolean; query: string; pos: number }>({
    open: false,
    query: "",
    pos: 0,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The textarea is disabled while streaming, so Escape is caught on the document. Escape inside
  // dialogs and text fields keeps its own meaning (close dialog, cancel editing).
  const canStop = busy && onStop !== undefined;
  useEffect(() => {
    if (!canStop) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"], input, textarea, [contenteditable="true"]')) return;
      onStop?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canStop, onStop]);

  useEffect(() => {
    const el = textareaRef.current;
    if (restored === null || el === null) return;
    setInput(restored.text);
    el.value = restored.text;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + "px";
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
    el.focus();
    el.setSelectionRange(restored.text.length, restored.text.length);
  }, [restored]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);

    // Auto-grow: reset to 1 row, then expand to content (capped at MAX_HEIGHT)
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, MAX_HEIGHT) + "px";
    e.target.style.overflowY = e.target.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";

    // Detect @-mention
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1 && !before.slice(atIdx).includes(" ")) {
      setMention({ open: true, query: before.slice(atIdx + 1), pos: atIdx });
    } else {
      setMention((m) => ({ ...m, open: false }));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setMention((m) => ({ ...m, open: false }));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mention.open) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const t = input.trim();
    if (!t || disabled) return;
    onSend(t);
    setInput("");
    setMention((m) => ({ ...m, open: false }));
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
  }

  function insertDocMention(doc: Document) {
    const before = input.slice(0, mention.pos);
    const after = input.slice(mention.pos + 1 + mention.query.length);
    setInput(`${before}@${doc.filename} ${after}`);
    setMention((m) => ({ ...m, open: false }));
    textareaRef.current?.focus();
  }

  const q = mention.query.toLowerCase();
  const filteredDocs = documents.filter((d) => d.filename.toLowerCase().includes(q));

  return (
    <div className="shrink-0 px-5 pb-4 pt-2">
      <div
        title={disabled && disabledReason ? disabledReason : undefined}
        className="relative max-w-2xl mx-auto rounded-2xl px-4 py-3 transition-all bg-input-bg focus-within:bg-input-bg-focus"
      >
        {/* @-mention dropdown */}
        {mention.open && filteredDocs.length > 0 && (
          <div
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden bg-white border border-panel"
            style={{ boxShadow: "0 4px 24px rgba(30,25,75,0.12)" }}
          >
            <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
              Documents
            </p>
            {filteredDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => insertDocMention(doc)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-input-bg text-brand"
              >
                <FileText size={12} strokeWidth={1.75} className="shrink-0 text-muted-light" />
                {doc.filename}
              </button>
            ))}
            <div className="px-3 py-2 border-t border-[#F9FAFB]">
              <p className="text-[10px] text-placeholder">
                @ to reference a document
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            className="flex-1 resize-none chat-text bg-transparent outline-none text-brand placeholder:text-muted-light disabled:opacity-50 overflow-hidden"
            style={{ maxHeight: MAX_HEIGHT }}
          />
          {canStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop (Esc)"
              className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-brand text-white transition-opacity hover:opacity-90"
            >
              <Square size={12} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              aria-label="Send"
              disabled={!input.trim() || disabled}
              className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
              style={{
                backgroundColor: input.trim() && !disabled ? "#1E194B" : "transparent",
                color: input.trim() && !disabled ? "#FFFFFF" : "#C4C9D4",
                cursor: input.trim() && !disabled ? "pointer" : "default",
              }}
            >
              <Send size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <p className="text-center text-[10px] mt-2 text-timestamp">
        {canStop ? "Esc to stop" : "Enter to send · Shift+Enter for new line · @ to reference a document"}
      </p>
    </div>
  );
}
