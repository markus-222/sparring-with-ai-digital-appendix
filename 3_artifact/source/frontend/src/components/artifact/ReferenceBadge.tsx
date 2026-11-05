/**
 * Icon-only reference badge with a small app-styled tooltip (shown on
 * hover/focus) instead of the browser's native `title` tooltip, which reads
 * as unstyled/system UI and doesn't match the app's look. Pure CSS
 * (opacity + group-hover), so it works for many inline instances per
 * message without the overhead of a portal-based tooltip primitive.
 *
 * Shared by the react-markdown path (`createReferenceComponents`) and the
 * Tiptap citation node view.
 */
export function ReferenceBadge({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <span className="relative inline-block group/ref align-text-bottom">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="inline-flex items-center justify-center mx-0.5 text-muted-light hover:text-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:text-muted-foreground"
      >
        {icon}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/ref:opacity-100 group-focus-within/ref:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
