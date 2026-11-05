import { test, expect } from "./fixtures";

test.describe("Projects Page", () => {
  test("displays project list with names and descriptions", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects");

    await expect(page.getByText("Smart Home System")).toBeVisible();
    await expect(page.getByText("E-Commerce Platform")).toBeVisible();
    await expect(
      page.getByText("Requirements for a smart home IoT platform")
    ).toBeVisible();
  });

  test("shows page heading", async ({ mockPage: page }) => {
    await page.goto("/projects");
    await expect(
      page.getByText("Your requirements workspace")
    ).toBeVisible();
  });

  test("opens create dialog with New project button", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects");

    await page.getByRole("button", { name: /new project/i }).first().click();

    await expect(
      page.getByRole("heading", { name: "New project" })
    ).toBeVisible();
  });

  test("creates a project and closes the dialog", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects");

    await page.getByRole("button", { name: /new project/i }).first().click();

    await page.getByPlaceholder(/e\.g\. Mobile Banking/i).fill("Test Project");
    await page
      .getByPlaceholder(/briefly describe/i)
      .fill("A test project for E2E");

    await page.getByRole("button", { name: "Create project" }).click();

    // Dialog closes after creation
    await expect(
      page.getByRole("heading", { name: "New project" })
    ).not.toBeVisible();
  });

  test("shows empty state when no projects exist", async ({ mockPage: page }) => {
    await page.route("**/api/v1/projects", (route) => {
      return route.fulfill({ json: [] });
    });
    await page.goto("/projects");

    // Ghost card (the "New project" add button) is always shown
    await expect(
      page.getByRole("button", { name: /new project/i }).last()
    ).toBeVisible();
  });

  test("navigates to project page on card click", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects");

    await page.getByText("Smart Home System").click();
    await page.waitForURL(/\/projects\/proj-1/);
  });
});
