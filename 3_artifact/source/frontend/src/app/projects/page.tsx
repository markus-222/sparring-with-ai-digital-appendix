"use client";

import { useState, useMemo, useEffect } from "react";
import { useProjects, useCurrentUser, projectsApi, invalidateProjects } from "@/lib/api";
import { Plus, Search, CheckCircle2, FolderOpen, Settings } from "lucide-react";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { EditProjectModal } from "@/components/projects/EditProjectModal";
import { DeleteProjectModal } from "@/components/projects/DeleteProjectModal";
import { AppHeader } from "@/components/layout/AppHeader";
import type { Project } from "@/types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(15,23,42,0.3)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-2xl p-8 flex flex-col gap-5"
        style={{ width: 440, boxShadow: "0 8px 40px rgba(30,25,75,0.12)" }}
      >
        <div>
          <h2 className="text-base font-semibold text-brand">New project</h2>
          <p className="text-xs mt-1 text-muted-light">
            Create a workspace for your requirements engineering project.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Project name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Mobile Banking App v3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onCreate(name.trim(), desc.trim());
                  onClose();
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
              placeholder="Briefly describe the scope of this project…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="text-sm px-3 py-2.5 rounded-xl outline-none resize-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl transition-colors hover:bg-input-bg text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (name.trim()) {
                onCreate(name.trim(), desc.trim());
                onClose();
              }
            }}
            disabled={!name.trim()}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl text-white transition-opacity ${name.trim() ? "bg-brand cursor-pointer" : "bg-placeholder cursor-default"}`}
          >
            <Plus size={14} strokeWidth={2.5} />
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { data: user } = useCurrentUser();
  const firstName = user?.display_name?.trim().split(/\s+/)[0] ?? "";
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

  const filtered = useMemo(() => {
    if (!projects) return [];
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  async function handleCreate(name: string, description: string) {
    await projectsApi.create({
      name,
      description: description || null,
    });
    invalidateProjects();
  }

  async function handleDelete(project: Project) {
    setDeletingProject(project);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "linear-gradient(180deg, #ffffff 0%, #F8F7FB 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{ backgroundColor: "#CBBFFB", opacity: 0.04 }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 15% 8%, #7A5CF6 0%, transparent 42%), radial-gradient(circle at 82% 45%, #3DA8FF 0%, transparent 45%), radial-gradient(circle at 35% 92%, #F570B8 0%, transparent 45%)",
          filter: "blur(140px)",
          opacity: 0.06,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "radial-gradient(circle, #1E194B 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.035,
        }}
      />

      {/* Use AppHeader component instead of custom header */}
      <AppHeader />

      {/* Page content */}
      <div className="flex-1 overflow-y-auto relative z-[1] pt-[52px]">
        {/* Hero */}
        <section className="flex flex-col items-center text-center px-6 pt-20 pb-8">
          {greeting && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-3 bg-panel text-text-secondary">
              <CheckCircle2 size={11} strokeWidth={2} className="text-success" />
              {firstName ? `${greeting}, ${firstName}` : greeting}
            </div>
          )}
          <h1 className="text-2xl font-bold leading-snug mb-2 text-brand tracking-tight">
            Your requirements workspace
          </h1>
          <p className="text-xs leading-relaxed text-muted-light max-w-[340px]">
            Work with AI agents to elicit, structure, and validate software
            requirements.
          </p>
        </section>

        {/* Grid */}
        <section className="px-8 pb-16 mx-auto" style={{ maxWidth: 1100 }}>
          <div className="flex items-center justify-between mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-text">
              All projects
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text"
                />
                <input
                  type="text"
                  placeholder="Search projects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-xl outline-none transition-all border border-input-border bg-white text-brand w-[200px] focus:border-brand"
                />
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl text-white transition-colors hover:bg-accent-grape bg-brand"
              >
                <Plus size={13} strokeWidth={2.5} />
                New project
              </button>
            </div>
          </div>

          {isLoading ? (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-[160px] rounded-2xl border border-panel bg-white animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              }}
            >
              {filtered.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDelete}
                  onEdit={setEditingProject}
                />
              ))}
              {/* Ghost card */}
              <button
                onClick={() => setShowModal(true)}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl transition-all group border-[1.5px] border-dashed border-input-border hover:border-placeholder"
                style={{ minHeight: 160, backgroundColor: "rgba(255, 255, 255, 0.4)" }}
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors group-hover:bg-brand-light bg-input-bg">
                  <Plus size={15} strokeWidth={2} className="text-muted-text" />
                </div>
                <span className="text-xs text-muted-text">New project</span>
              </button>
            </div>
          )}
        </section>
      </div>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}

      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}

      {deletingProject && (
        <DeleteProjectModal
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
        />
      )}
    </div>
  );
}
