import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw-server";
import { ApiError } from "@/lib/api/errors";
import { API, fetchAPI, fetcher, redirectsOnUnauthorized } from "@/lib/api/fetcher";

afterEach(() => {
  vi.restoreAllMocks();
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

describe("fetchAPI errors", () => {
  it("throws ApiError with code and message for a structured 409", async () => {
    server.use(
      http.post(`${API}/x`, () =>
        HttpResponse.json(
          { detail: { code: "run_active", message: "A run is active. Please wait." } },
          { status: 409 },
        ),
      ),
    );
    const err = await caught(fetchAPI("/x", { method: "POST" }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "run_active", message: "A run is active. Please wait." });
  });

  it("uses a string detail as message with code null", async () => {
    server.use(http.get(`${API}/x`, () => HttpResponse.json({ detail: "Session not found" }, { status: 404 })));
    const err = await caught(fetchAPI("/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: null, message: "Session not found" });
  });

  it("falls back to API error: <status> for a non-JSON body", async () => {
    server.use(http.get(`${API}/x`, () => new HttpResponse("oops", { status: 500 })));
    const err = await caught(fetchAPI("/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: null, message: "API error: 500" });
  });

  it("returns undefined for 204", async () => {
    server.use(http.delete(`${API}/x`, () => new HttpResponse(null, { status: 204 })));
    await expect(fetchAPI("/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("returns parsed JSON on success", async () => {
    server.use(http.get(`${API}/x`, () => HttpResponse.json({ ok: true })));
    await expect(fetchAPI("/x")).resolves.toEqual({ ok: true });
  });
});

describe("fetcher errors", () => {
  it("throws ApiError for a structured error", async () => {
    server.use(
      http.get(`${API}/y`, () =>
        HttpResponse.json({ detail: { code: "not_draft", message: "Not a draft." } }, { status: 409 }),
      ),
    );
    const err = await caught(fetcher(`${API}/y`));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "not_draft", message: "Not a draft." });
  });

  it("returns parsed JSON on success", async () => {
    server.use(http.get(`${API}/y`, () => HttpResponse.json([1, 2])));
    await expect(fetcher(`${API}/y`)).resolves.toEqual([1, 2]);
  });
});

describe("401 handling", () => {
  it("still throws ApiError with status 401", async () => {
    server.use(http.get(`${API}/z`, () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })));
    const err = await caught(fetchAPI("/z"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: "Not authenticated" });
  });

  it("keeps the backend message for wrong credentials on login", async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ detail: "Invalid username or password" }, { status: 401 }),
      ),
    );
    const err = await caught(fetchAPI("/auth/login", { method: "POST" }));
    expect(err).toMatchObject({ status: 401, message: "Invalid username or password" });
  });
});

describe("redirectsOnUnauthorized", () => {
  it("is false for the credential endpoints, where a 401 means wrong input", () => {
    expect(redirectsOnUnauthorized("/auth/login")).toBe(false);
    expect(redirectsOnUnauthorized("/auth/register")).toBe(false);
  });

  it("is true for every other endpoint, where a 401 means the session expired", () => {
    expect(redirectsOnUnauthorized("/auth/me")).toBe(true);
    expect(redirectsOnUnauthorized("/projects")).toBe(true);
    expect(redirectsOnUnauthorized(`${API}/artifacts`)).toBe(true);
  });
});
