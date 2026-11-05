import { expect, test } from "./fixtures";

// Customer documents live in the overview (right column) of the project page.
test.describe("Overview – customer documents", () => {
  test("displays the uploaded document filenames", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");

    await expect(page.getByText("CUSTOMER DOCUMENTS")).toBeVisible();
    await expect(page.getByText("smart-home-spec.pdf")).toBeVisible();
    await expect(page.getByText("iot-standards.md")).toBeVisible();
  });

  test("shows the upload drop zone", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");

    await expect(page.getByRole("button", { name: /upload file/i })).toBeVisible();
  });

  test("uploads a file via the hidden file input", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");

    await page.locator('input[type="file"]').setInputFiles({
      name: "test-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Test document content for upload"),
    });

    await expect(page.getByText(/file uploaded successfully/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("uploaded-file.txt")).toBeVisible();
  });

  test("shows the empty state when no documents are uploaded", async ({ mock, mockPage: page }) => {
    mock.documents = [];
    await page.goto("/projects/proj-1");

    await expect(page.getByText("No documents uploaded yet")).toBeVisible();
  });
});
