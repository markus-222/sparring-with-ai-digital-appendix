"use client";

import { memo, useState } from "react";
import { Check, X } from "lucide-react";
import type { ProposalResult } from "@/hooks/useChat";
import type { QuestionProposal } from "@/types/chat";

interface ProposalCardProps {
  proposal: QuestionProposal;
  disabled?: boolean;
  onResolve: (action: "accept" | "reject", questionIds: string[], revoke: boolean) => Promise<ProposalResult>;
}

const BUTTON =
  "text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Workshop questions the Analyst offers: pick some, add them to 03 or dismiss the offer. */
export const ProposalCard = memo(function ProposalCard({ proposal, disabled = false, onResolve }: ProposalCardProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(proposal.questions.map((q) => q.id)),
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRevoke, setNeedsRevoke] = useState(false);

  const open = proposal.status === "open";
  const chosen = proposal.questions.filter((q) => selected.has(q.id)).map((q) => q.id);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(action: "accept" | "reject", revoke: boolean): Promise<void> {
    setWorking(true);
    setError(null);
    const result = await onResolve(action, action === "accept" ? chosen : [], revoke);
    setWorking(false);
    if (result.ok) {
      setNeedsRevoke(false);
      return;
    }
    if (result.code === "needs_revoke") {
      setNeedsRevoke(true);
      return;
    }
    setNeedsRevoke(false);
    setError(
      result.code === "run_active"
        ? "Ein Schritt läuft gerade. Bitte warten, bis er abgeschlossen ist."
        : result.message,
    );
  }

  const busy = disabled || working;
  const accepted = proposal.questions.filter((q) => q.state === "accepted").length;

  return (
    <div data-testid="proposal-card" className="ml-10 flex flex-col gap-3 rounded-2xl border border-panel bg-white px-4 py-3" style={{ maxWidth: "85%" }}>
      <ul className="flex flex-col gap-2">
        {proposal.questions.map((q) => {
          const dropped = !open && q.state !== "accepted";
          return (
            <li key={q.id} className="flex items-start gap-2">
              {open ? (
                <input
                  type="checkbox"
                  id={`proposal-${q.id}`}
                  className="mt-1"
                  checked={selected.has(q.id)}
                  disabled={busy}
                  onChange={() => toggle(q.id)}
                />
              ) : q.state === "accepted" ? (
                <Check size={14} aria-label="übernommen" className="mt-1 shrink-0 text-brand" />
              ) : (
                <X size={14} aria-label="nicht übernommen" className="mt-1 shrink-0 text-placeholder" />
              )}
              <label
                htmlFor={open ? `proposal-${q.id}` : undefined}
                className={`chat-text flex flex-col ${dropped ? "text-placeholder line-through" : ""}`}
              >
                <span className="font-semibold">{q.title}</span>
                <span>{q.text}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {open && !needsRevoke && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void run("accept", false)}
            className={`${BUTTON} border-brand bg-brand text-white hover:opacity-90`}
          >
            Übernehmen ({chosen.length})
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("reject", false)}
            className={`${BUTTON} border-accent-grape-border bg-white text-brand hover:bg-brand-light`}
          >
            Verwerfen
          </button>
        </div>
      )}

      {open && needsRevoke && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-secondary">
            03 ist freigegeben. Das Hinzufügen widerruft die Freigabe.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("accept", true)}
              className={`${BUTTON} border-brand bg-brand text-white hover:opacity-90`}
            >
              Freigabe widerrufen und übernehmen
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setNeedsRevoke(false)}
              className={`${BUTTON} border-accent-grape-border bg-white text-brand hover:bg-brand-light`}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {!open && (
        <p className="text-xs text-text-secondary">
          {proposal.status === "accepted"
            ? `${accepted} ${accepted === 1 ? "Frage" : "Fragen"} zu 03 übernommen`
            : "Verworfen"}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});
