"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, MoreHorizontal, Trash2, Clock, Edit2 } from "lucide-react";
import type { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => void;
  onEdit: (project: Project) => void;
}

export function ProjectCard({ project, onDelete, onEdit }: ProjectCardProps) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setMenuOpen(false);
      }}
      onClick={() => router.push(`/projects/${project.id}`)}
      className="group flex flex-col p-5 rounded-2xl cursor-pointer transition-all"
      style={{
        border: "1px solid",
        borderColor: hovered ? "rgba(203,191,251,0.6)" : "rgba(203,191,251,0.35)",
        backgroundColor: hovered ? "#FAFAFA" : "#FFFFFF",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-brand-light">
          <FolderOpen size={14} strokeWidth={1.75} className="text-brand" />
        </div>
        <div className="relative">
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-panel text-muted-light"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-10 w-32 rounded-md border border-input-border bg-white shadow-md py-1">
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-brand hover:bg-panel transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onEdit(project);
                }}
              >
                <Edit2 className="h-3 w-3" />
                Edit
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete(project);
                }}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <h3 className="text-sm font-semibold mb-1.5 leading-snug text-brand">
        {project.name}
      </h3>
      {project.description && (
        <p className="text-xs leading-relaxed flex-1 mb-4 text-muted-light line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="flex items-center mt-auto">
        <span className="flex items-center gap-1 text-[11px] text-muted-light">
          <Clock size={11} strokeWidth={1.75} />
          {formatDate(project.updated_at)}
        </span>
      </div>
    </div>
  );
}
