import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw-server";
import { API } from "@/lib/api/fetcher";
import { documentsApi, MAX_UPLOAD_MB } from "@/lib/api/documents";

const sizedFile = (bytes: number) => {
  const file = new File(["x"], "spec.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
};

describe("documentsApi upload size limit", () => {
  it("rejects an oversized file without sending it", async () => {
    let requests = 0;
    server.use(
      http.post(`${API}/documents/upload`, () => {
        requests += 1;
        return HttpResponse.json({});
      }),
    );
    const file = sizedFile(MAX_UPLOAD_MB * 1024 * 1024 + 1);
    await expect(documentsApi.upload("p1", file)).rejects.toThrow("File too large (max. 25 MB)");
    await expect(documentsApi.replace("d1", file)).rejects.toThrow("File too large (max. 25 MB)");
    expect(requests).toBe(0);
  });

  it("maps a 413 from the ingress to the same message", async () => {
    server.use(
      http.post(`${API}/documents/upload`, () => new HttpResponse("<html>413</html>", { status: 413 })),
    );
    await expect(documentsApi.upload("p1", sizedFile(10))).rejects.toThrow(
      "File too large (max. 25 MB)",
    );
  });

  it("keeps the backend detail for other errors", async () => {
    server.use(
      http.post(`${API}/documents/upload`, () =>
        HttpResponse.json({ detail: "Unsupported file type: x" }, { status: 400 }),
      ),
    );
    await expect(documentsApi.upload("p1", sizedFile(10))).rejects.toThrow(
      "Unsupported file type: x",
    );
  });
});
