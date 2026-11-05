"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import type { Session } from "@/types";

export interface SessionHistoryProps {
  /** Newest first. */
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}

function sessionLabel(session: Session, index: number, total: number): string {
  const when = new Date(session.created_at).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return session.title ?? `Chat ${total - index} · ${when}`;
}

export function SessionHistory({ sessions, activeSessionId, onSelect }: SessionHistoryProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (sessions.length < 2) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-panel text-text-secondary transition-colors hover:bg-input-bg"
      >
        <History size={11} strokeWidth={2} />
        History
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Earlier chats"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-panel bg-white py-1 shadow-lg"
        >
          {sessions.map((session, index) => {
            const active = session.id === activeSessionId;
            return (
              <li key={session.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!active) onSelect(session.id);
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-input-bg ${
                    active ? "font-semibold text-text-primary" : "text-text-secondary"
                  }`}
                >
                  {sessionLabel(session, index, sessions.length)}
                  {index === 0 && <span className="ml-1 text-placeholder">(latest)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
