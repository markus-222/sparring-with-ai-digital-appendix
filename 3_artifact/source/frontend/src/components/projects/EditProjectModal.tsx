"use client";

import { useState } from "react";
import { projectsApi, invalidateProjects } from "@/lib/api";
import { X } from "lucide-react";
import type { Project } from "@/types";

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
}

export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await projectsApi.update(project.id, {
        name: name.trim(),
        description: desc.trim() || null,
      });
      invalidateProjects();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setIsSaving(false);
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
        style={{ maxWidth: 440, boxShadow: "0 8px 40px rgba(30,25,75,0.12)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-brand">Edit project</h2>
            <p className="text-xs mt-1 text-muted-light">
              Update project name and description.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-input-bg rounded-lg transition-colors"
          >
            <X size={16} className="text-muted-text" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Project name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSaving) {
                  handleSave();
                }
              }}
              className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Description{" "}
              <span className="text-placeholder">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="text-sm px-3 py-2.5 rounded-xl outline-none resize-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand"
            />
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
            disabled={isSaving}
            className="px-4 py-2 text-sm rounded-xl transition-colors hover:bg-input-bg text-text-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className={`px-4 py-2 text-sm font-medium rounded-xl text-white transition-colors ${
              isSaving || !name.trim()
                ? "bg-placeholder cursor-default"
                : "bg-brand cursor-pointer hover:bg-accent-grape"
            }`}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
