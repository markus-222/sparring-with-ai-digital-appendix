import useSWR from "swr";
import { ApiError } from "@/lib/api/errors";
import { API, fetcher } from "@/lib/api/fetcher";
import type {
  ApprovedVersion,
  Project,
  Session,
  SessionDetail,
  Artifact,
  Comment,
  Document,
  User,
} from "@/types";

export function useProjects() {
  return useSWR<Project[]>(`${API}/projects`, fetcher);
}

export function useProject(id: string | null) {
  return useSWR<Project>(id ? `${API}/projects/${id}` : null, fetcher);
}

export function useSessions(projectId: string | null) {
  return useSWR<Session[]>(
    projectId ? `${API}/sessions?project_id=${projectId}` : null,
    fetcher,
  );
}

export function useSession(id: string | null) {
  return useSWR<SessionDetail>(id ? `${API}/sessions/${id}` : null, fetcher);
}

export function useArtifacts(projectId: string | null) {
  return useSWR<Artifact[]>(
    projectId ? `${API}/artifacts?project_id=${projectId}` : null,
    fetcher,
  );
}

export function useArtifact(id: string | null) {
  return useSWR<Artifact>(id ? `${API}/artifacts/${id}` : null, fetcher);
}

/** Last approved version of an artifact. A 404 (never approved) is an `ApiError` in `error` and is not retried. */
export function useApprovedVersion(artifactId: string | null) {
  return useSWR<ApprovedVersion, ApiError>(
    artifactId ? `${API}/artifacts/${artifactId}/approved-version` : null,
    fetcher,
    { shouldRetryOnError: (err) => !(err instanceof ApiError && err.status === 404) },
  );
}

export function useComments(artifactId: string | null) {
  return useSWR<Comment[]>(
    artifactId ? `${API}/comments?artifact_id=${artifactId}` : null,
    fetcher,
  );
}

export function useDocuments(projectId: string | null) {
  return useSWR<Document[]>(
    projectId ? `${API}/documents?project_id=${projectId}` : null,
    fetcher,
  );
}

export function useCurrentUser() {
  return useSWR<User>(`${API}/auth/me`, fetcher);
}
