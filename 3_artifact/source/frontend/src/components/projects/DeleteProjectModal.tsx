"use client";

import { useState } from "react";
import { projectsApi, invalidateProjects } from "@/lib/api";
import { AlertCircle } from "lucide-react";
import type { Project } from "@/types";

interface DeleteProjectModalProps {
  project: Project;
  onClose: () => void;
}

export function DeleteProjectModal({ project, onClose }: DeleteProjectModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      await projectsApi.delete(project.id);
      invalidateProjects();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(15,23,42,0.3)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-2xl p-8 flex flex-col gap-5 w-full mx-4"
        style={{ maxWidth: 400, boxShadow: "0 8px 40px rgba(30,25,75,0.12)" }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-50">
            <AlertCircle size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-brand">Delete project</h2>
            <p className="text-xs mt-1 text-muted-light">
              All project data will be permanently deleted.
            </p>
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm rounded-xl transition-colors hover:bg-input-bg text-text-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className={`px-4 py-2 text-sm font-medium rounded-xl text-white transition-opacity ${
              isDeleting
                ? "bg-red-400 cursor-default"
                : "bg-red-600 cursor-pointer hover:bg-red-700"
            }`}
          >
            {isDeleting ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}
