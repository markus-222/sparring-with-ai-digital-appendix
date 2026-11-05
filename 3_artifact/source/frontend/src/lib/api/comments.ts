import { fetchAPI } from "@/lib/api/fetcher";
import type { Comment, CommentAction, Suggestion } from "@/types";

export const commentsApi = {
  list: (artifactId: string) =>
    fetchAPI<Comment[]>(`/comments?artifact_id=${artifactId}`),
  accept: (id: string) =>
    fetchAPI<CommentAction>(`/comments/${id}/accept`, { method: "POST" }),
  edit: (id: string, suggestion: Suggestion) =>
    fetchAPI<CommentAction>(`/comments/${id}/edit`, {
      method: "POST",
      body: JSON.stringify({ suggestion }),
    }),
  reject: (id: string) =>
    fetchAPI<CommentAction>(`/comments/${id}/reject`, { method: "POST" }),
  doneManually: (id: string) =>
    fetchAPI<CommentAction>(`/comments/${id}/done-manually`, { method: "POST" }),
};
