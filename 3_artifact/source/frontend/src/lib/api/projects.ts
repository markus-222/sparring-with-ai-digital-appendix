import { fetchAPI } from "@/lib/api/fetcher";
import type { Project, ProjectCreate, ProjectUpdate } from "@/types";

export const projectsApi = {
  create: (data: ProjectCreate) =>
    fetchAPI<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: ProjectUpdate) =>
    fetchAPI<Project>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/projects/${id}`, { method: "DELETE" }),
};
