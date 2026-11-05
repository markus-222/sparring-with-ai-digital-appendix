import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw-server";
import { API } from "@/lib/api/fetcher";
import { runsApi } from "@/lib/api/runs";
import type { Run } from "@/types";

const RUN: Run = {
  id: "r1",
  project_id: "p1",
  type: "draft",
  slot: "01",
  state: "running",
  step: "reading",
  error: null,
  created_at: "2026-10-04T10:00:00Z",
  finished_at: null,
};

describe("runsApi", () => {
  it("start posts type and slot", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API}/projects/p1/runs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(RUN, { status: 202 });
      }),
    );
    await expect(runsApi.start("p1", { type: "draft", slot: "01" })).resolves.toEqual(RUN);
    expect(body).toEqual({ type: "draft", slot: "01" });
  });

  it("active returns the run or null", async () => {
    server.use(http.get(`${API}/projects/p1/runs/active`, () => HttpResponse.json(RUN)));
    await expect(runsApi.active("p1")).resolves.toEqual(RUN);
    server.use(http.get(`${API}/projects/p1/runs/active`, () => HttpResponse.json(null)));
    await expect(runsApi.active("p1")).resolves.toBeNull();
  });

  it("get fetches a run by id", async () => {
    server.use(http.get(`${API}/runs/r1`, () => HttpResponse.json(RUN)));
    await expect(runsApi.get("r1")).resolves.toEqual(RUN);
  });
});
