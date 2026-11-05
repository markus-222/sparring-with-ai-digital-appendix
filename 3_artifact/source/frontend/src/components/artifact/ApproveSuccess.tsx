"use client";

import { ShieldCheck } from "lucide-react";

export interface ApproveSuccessProps {
  title: string;
}

/** Brief confirmation over the right-hand panel after an artifact was approved; same look as the run overlay. */
export function ApproveSuccess({ title }: ApproveSuccessProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/50 backdrop-blur-[2px] animate-in fade-in duration-200 motion-reduce:animate-none">
      <div
        role="status"
        className="flex w-[320px] max-w-[90%] flex-col items-center gap-3 rounded-2xl bg-white px-5 py-6 text-center shadow-lg ring-1 ring-brand/10 animate-in zoom-in-95 duration-200 motion-reduce:animate-none"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-brand text-white">
          <ShieldCheck size={20} strokeWidth={1.75} />
        </span>
        <h2 className="font-heading text-sm font-normal text-brand">Artifact approved</h2>
        <p className="text-sm text-text-secondary">{title}</p>
      </div>
    </div>
  );
}
