export type MarkerKind = "conflict" | "unclear";

const MARKERS: Record<MarkerKind, { label: string; className: string }> = {
  conflict: {
    label: "CONFLICT",
    className: "bg-yellow-100 text-yellow-800 border-yellow-300",
  },
  unclear: {
    label: "UNCLEAR",
    className: "bg-slate-100 text-slate-600 border-slate-300",
  },
};

/** Reading-view badge for `⚠ CONFLICT` (yellow) and `? UNCLEAR` (grey-blue). */
export function MarkerBadge({ kind }: { kind: MarkerKind }) {
  const marker = MARKERS[kind];
  return (
    <span
      data-marker={kind}
      className={`inline-flex items-center px-1.5 py-px mr-0.5 rounded border text-[10px] font-semibold tracking-wide align-middle ${marker.className}`}
    >
      {marker.label}
    </span>
  );
}
