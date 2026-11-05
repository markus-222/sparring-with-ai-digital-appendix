import { fetchAPI } from "@/lib/api/fetcher";
import type { Run, RunType, Slot } from "@/types";

export const runsApi = {
  start: (projectId: string, data: { type: RunType; slot: Slot }) =>
    fetchAPI<Run>(`/projects/${projectId}/runs`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  active: (projectId: string) => fetchAPI<Run | null>(`/projects/${projectId}/runs/active`),
  get: (runId: string) => fetchAPI<Run>(`/runs/${runId}`),
};
