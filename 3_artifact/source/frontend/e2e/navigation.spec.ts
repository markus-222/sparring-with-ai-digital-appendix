import { test, expect } from "./fixtures";

test.describe("Navigation", () => {
  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/);
  });

  test("authenticated user at / is redirected to /projects", async ({
    mockPage: page,
  }) => {
    await page.route("**/api/v1/projects", (route) => {
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    await page.waitForURL(/\/projects/);
  });

  test("project page loads with project name in header", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");
    await expect(page.getByText("Smart Home System")).toBeVisible();
  });

  test("AiRE logo link navigates back to projects list", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");

    // The header logo is a link to /projects
    await page.getByRole("link", { name: "AiRE" }).click();
    await page.waitForURL(/\/projects$/);
  });
});
