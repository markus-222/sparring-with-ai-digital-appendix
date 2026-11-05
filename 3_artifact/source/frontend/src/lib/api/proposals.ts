import { fetchAPI } from "@/lib/api/fetcher";
import type { ProposalResolution, ResolveProposalBody } from "@/types/chat";

export const proposalsApi = {
  resolve: (sessionId: string, messageId: string, body: ResolveProposalBody) =>
    fetchAPI<ProposalResolution>(`/sessions/${sessionId}/proposals/${messageId}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
