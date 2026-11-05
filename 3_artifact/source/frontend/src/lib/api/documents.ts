import { API, fetchAPI } from "@/lib/api/fetcher";
import type { Document } from "@/types";

// Maximum upload size per document.
export const MAX_UPLOAD_MB = 25;
const TOO_LARGE = `File too large (max. ${MAX_UPLOAD_MB} MB)`;

const tooLarge = (file: File) => file.size > MAX_UPLOAD_MB * 1024 * 1024;

export const documentsApi = {
  upload: async (projectId: string, file: File) => {
    if (tooLarge(file)) throw new Error(TOO_LARGE);
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${API}/documents/upload?project_id=${projectId}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        // 413 comes from the ingress, without a JSON body.
        if (res.status === 413) throw new Error(TOO_LARGE);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload error: ${res.status}`);
      }
      return res.json() as Promise<Document>;
    });
  },
  replace: async (id: string, file: File) => {
    if (tooLarge(file)) throw new Error(TOO_LARGE);
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${API}/documents/${id}`, {
      method: "PUT",
      credentials: "include",
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        // 413 comes from the ingress, without a JSON body.
        if (res.status === 413) throw new Error(TOO_LARGE);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Replace error: ${res.status}`);
      }
      return res.json() as Promise<Document>;
    });
  },
  delete: (id: string) =>
    fetchAPI<void>(`/documents/${id}`, { method: "DELETE" }),
  download: async (id: string, filename: string): Promise<void> => {
    const res = await fetch(`${API}/documents/${id}/download`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  view: async (id: string): Promise<{ url: string; contentType: string }> => {
    const res = await fetch(`${API}/documents/${id}/view`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`View failed: ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), contentType };
  },
};
