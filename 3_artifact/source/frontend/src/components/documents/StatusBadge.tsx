"use client";

import { FileCheck2, FileClock, FileMinus } from "lucide-react";
import { statusLabel } from "@/lib/artifacts";
import type { ArtifactStatus } from "@/types";

const STATUS_CFG: Record<ArtifactStatus, { color: string; bg: string; icon: React.ReactNode }> = {
  not_started: { color: "#4B4B91", bg: "#F1F5F9", icon: <FileMinus size={12} strokeWidth={2} /> },
  draft: { color: "#854D0E", bg: "#FEF9C3", icon: <FileClock size={12} strokeWidth={2} /> },
  approved: { color: "#065F46", bg: "#ECFDF5", icon: <FileCheck2 size={12} strokeWidth={2} /> },
};

interface StatusBadgeProps {
  status: ArtifactStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_CFG[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.icon}
      {statusLabel(status)}
    </span>
  );
}
