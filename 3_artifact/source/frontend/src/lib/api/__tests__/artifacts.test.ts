import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw-server";
import { API } from "@/lib/api/fetcher";
import { artifactsApi, filenameFromDisposition } from "@/lib/api/artifacts";
import { ApiError } from "@/lib/api/errors";

describe("filenameFromDisposition", () => {
  it("reads the quoted filename", () => {
    expect(filenameFromDisposition('attachment; filename="01-project-description.md"')).toBe(
      "01-project-description.md",
    );
  });

  it("falls back without a usable header", () => {
    expect(filenameFromDisposition(null)).toBe("artifact.md");
    expect(filenameFromDisposition("attachment")).toBe("artifact.md");
  });
});

describe("artifactsApi", () => {
  it("delete sends DELETE and resolves on 204", async () => {
    let method = "";
    server.use(
      http.delete(`${API}/artifacts/a1`, ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(artifactsApi.delete("a1")).resolves.toBeUndefined();
    expect(method).toBe("DELETE");
  });

  describe("download", () => {
    let clicked: { href: string; download: string } | null;

    beforeEach(() => {
      clicked = null;
      URL.createObjectURL = vi.fn(() => "blob:artifact");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked = { href: this.href, download: this.download };
      });
    });

    afterEach(() => vi.restoreAllMocks());

    it("saves the response under the server's filename", async () => {
      server.use(
        http.get(`${API}/artifacts/a1/download`, () =>
          HttpResponse.text("# Text", {
            headers: { "Content-Disposition": 'attachment; filename="02-stakeholder-analysis.md"' },
          }),
        ),
      );
      await artifactsApi.download("a1");
      expect(clicked).toEqual({ href: "blob:artifact", download: "02-stakeholder-analysis.md" });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
    });

    it("throws the backend error and saves nothing", async () => {
      server.use(
        http.get(`${API}/artifacts/a1/download`, () =>
          HttpResponse.json(
            { detail: { code: "not_started", message: "This artifact has not been started yet." } },
            { status: 409 },
          ),
        ),
      );
      await expect(artifactsApi.download("a1")).rejects.toMatchObject({
        status: 409,
        code: "not_started",
      });
      await expect(artifactsApi.download("a1")).rejects.toBeInstanceOf(ApiError);
      expect(clicked).toBeNull();
    });
  });
});
