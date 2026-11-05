import type { LucideIcon } from "lucide-react";
import { Compass, SearchCheck } from "lucide-react";
import type { Comment } from "@/types";

export interface RoleStyle {
  icon: LucideIcon;
  /** Left edge of a comment card. */
  border: string;
  /** Role badge in the card header. */
  badge: string;
  /** Dot next to a section heading. */
  dot: string;
}

/** Reviewer blue / Explorer violet, the same colours as the gutter icons and passage tints (globals.css). */
export const ROLE_STYLE: Record<Comment["role"], RoleStyle> = {
  reviewer: {
    icon: SearchCheck,
    border: "border-l-blue-500",
    badge: "bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  explorer: {
    icon: Compass,
    border: "border-l-violet-500",
    badge: "bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
};
