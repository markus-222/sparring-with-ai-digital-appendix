import { API, fetchAPI } from "@/lib/api/fetcher";
import { toApiError } from "@/lib/api/errors";
import type { ApprovedArtifact, ApprovedVersion, Artifact, ArtifactUpdate } from "@/types";

const FALLBACK_FILENAME = "artifact.md";

/** Filename of a `Content-Disposition: attachment; filename="..."` header, or the fallback. */
export function filenameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? FALLBACK_FILENAME;
}

export const artifactsApi = {
  update: (id: string, data: ArtifactUpdate) =>
    fetchAPI<Artifact>(`/artifacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  /** With a session id the backend writes the next-step message into that chat and returns it. */
  approve: (id: string, force = false, sessionId: string | null = null) =>
    fetchAPI<ApprovedArtifact>(`/artifacts/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ force, session_id: sessionId }),
    }),
  approvedVersion: (id: string) =>
    fetchAPI<ApprovedVersion>(`/artifacts/${id}/approved-version`),
  /** Deleting a slot artifact (01-03) resets it to "not started". */
  delete: (id: string) => fetchAPI<void>(`/artifacts/${id}`, { method: "DELETE" }),
  download: async (id: string): Promise<void> => {
    const res = await fetch(`${API}/artifacts/${id}/download`, { credentials: "include" });
    if (!res.ok) throw await toApiError(res);
    const filename = filenameFromDisposition(res.headers.get("content-disposition"));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
