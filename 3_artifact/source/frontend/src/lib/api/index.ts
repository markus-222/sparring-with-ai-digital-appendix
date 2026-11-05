// Re-export everything from split modules for backward compatibility.
// Consumers can also import directly from sub-modules for tree-shaking.

export { fetcher, fetchAPI, API } from "@/lib/api/fetcher";
export {
  useProjects,
  useProject,
  useSessions,
  useSession,
  useArtifacts,
  useArtifact,
  useDocuments,
  useCurrentUser,
} from "@/lib/api/hooks";
export { projectsApi } from "@/lib/api/projects";
export { sessionsApi } from "@/lib/api/sessions";
export { documentsApi } from "@/lib/api/documents";
export { artifactsApi } from "@/lib/api/artifacts";
export { commentsApi } from "@/lib/api/comments";
export { proposalsApi } from "@/lib/api/proposals";
export {
  invalidateProjects,
  invalidateSessions,
  invalidateArtifacts,
  invalidateComments,
  invalidateDocuments,
} from "@/lib/api/cache";
export { authApi } from "@/lib/api/auth";
export { runsApi } from "@/lib/api/runs";
export { streamChat } from "@/lib/api/chat";
export { ApiError } from "@/lib/api/errors";
