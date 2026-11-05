import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw-server";
import { API } from "@/lib/api/fetcher";
import { ApiError } from "@/lib/api/errors";
import { proposalsApi } from "@/lib/api/proposals";
import { makeProposal } from "@/test/proposals";
import type { ProposalResolution } from "@/types/chat";

const RESOLUTION: ProposalResolution = {
  message_id: "m1",
  proposal: makeProposal({ status: "accepted" }),
  reply: null,
  artifact_id: "a3",
  start: 10,
  end: 40,
};

describe("proposalsApi", () => {
  it("resolve posts the choice to the card's endpoint", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API}/sessions/s1/proposals/m1/resolve`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(RESOLUTION);
      }),
    );
    const sent = { action: "accept" as const, question_ids: ["q1"], revoke: false, editor_open: false };
    await expect(proposalsApi.resolve("s1", "m1", sent)).resolves.toEqual(RESOLUTION);
    expect(body).toEqual(sent);
  });

  it("resolve surfaces the 409 error code", async () => {
    server.use(
      http.post(`${API}/sessions/s1/proposals/m1/resolve`, () =>
        HttpResponse.json({ detail: { code: "needs_revoke", message: "Approved" } }, { status: 409 }),
      ),
    );
    const err = await proposalsApi
      .resolve("s1", "m1", { action: "accept", question_ids: ["q1"], revoke: false, editor_open: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "needs_revoke" });
  });
});
