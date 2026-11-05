import { mutate } from "swr";

export function invalidateProjects() {
  mutate(
    (key: string) => typeof key === "string" && key.includes("/projects"),
  );
}

export function invalidateSessions(projectId?: string) {
  // Only invalidate the sessions list, never the session detail.
  // Invalidating session detail would re-seed messages and wipe local state.
  mutate(
    (key: string) =>
      typeof key === "string" &&
      key.includes("/sessions?project_id") &&
      (!projectId || key.includes(projectId)),
  );
}

export function invalidateArtifacts() {
  mutate(
    (key: string) => typeof key === "string" && key.includes("/artifacts"),
  );
}

/** Invalidates the comments of one artifact, or of all artifacts when no id is given. */
export function invalidateComments(artifactId?: string) {
  mutate(
    (key: string) =>
      typeof key === "string" &&
      (artifactId
        ? key.includes(`/comments?artifact_id=${artifactId}`)
        : key.includes("/comments?artifact_id=")),
  );
}

export function invalidateDocuments(projectId?: string) {
  mutate(
    (key: string) =>
      typeof key === "string" &&
      key.includes("/documents") &&
      (!projectId || key.includes(projectId)),
  );
}
