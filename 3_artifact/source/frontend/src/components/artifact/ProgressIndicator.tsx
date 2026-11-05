"use client";

import { Check, Loader2 } from "lucide-react";
import { progressLines, type ProgressLine } from "@/lib/runProgress";
import type { Run } from "@/types";

export interface ProgressIndicatorProps {
  run: Run;
}

const TITLES: Record<Run["type"], string> = {
  draft: "Creating the draft",
  review: "Reviewing the draft",
};

function LineIcon({ state }: { state: ProgressLine["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-mid text-success-dark">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <Loader2 size={12} strokeWidth={3} className="animate-spin motion-reduce:animate-none" />
      </span>
    );
  }
  return <span className="size-5 shrink-0 rounded-full border-2 border-placeholder" />;
}

/**
 * Centered card over the artifact panel while a run is active; shows the pipeline state,
 * never content. The panel behind it is blurred and blocked, but the overlay is scoped to the
 * right-hand panel so the chat stays usable for questions during a run.
 */
export function ProgressIndicator({ run }: ProgressIndicatorProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/50 backdrop-blur-[2px] animate-in fade-in duration-200 motion-reduce:animate-none">
      <div
        role="status"
        className="w-[320px] max-w-[90%] overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-brand/10"
      >
        <div className="px-5 py-4">
          <h2 className="mb-3 font-heading text-sm font-normal text-brand">{TITLES[run.type]}</h2>
          <ul className="flex flex-col gap-2.5">
            {progressLines(run).map((line) => (
              <li
                key={line.id}
                data-state={line.state}
                className={`flex items-center gap-3 text-sm ${
                  line.state === "active"
                    ? "text-brand"
                    : line.state === "done"
                      ? "text-text-secondary"
                      : "text-muted-light"
                }`}
              >
                <LineIcon state={line.state} />
                <span>{line.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
