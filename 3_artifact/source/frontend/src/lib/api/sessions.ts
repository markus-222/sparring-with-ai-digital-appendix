import { fetchAPI } from "@/lib/api/fetcher";
import type { Session, SessionCreate } from "@/types";

export const sessionsApi = {
  create: (data: SessionCreate) =>
    fetchAPI<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  list: (projectId: string) =>
    fetchAPI<Session[]>(`/sessions?project_id=${projectId}`),
};
