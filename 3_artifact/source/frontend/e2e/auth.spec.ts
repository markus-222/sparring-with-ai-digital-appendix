import { test, expect, mockAPI, setAuthCookie } from "./fixtures";

test.describe("Auth – unauthenticated", () => {
  test("navigating to /projects redirects to /login", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForURL(/\/login/);
  });

  test("login page renders username and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("register page renders all fields", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i })
    ).toBeVisible();
  });

  test("successful login redirects to /projects", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/login");
    await page.getByLabel("Username").fill("testuser");
    await page.getByLabel("Password").fill("testpass123");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/projects/);
  });

  test("wrong password shows an error for a few seconds and stays on /login", async ({ page }) => {
    await page.route("**/api/v1/auth/login", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid username or password" }),
      })
    );
    await page.goto("/login");
    await page.getByLabel("Username").fill("testuser");
    await page.getByLabel("Password").fill("wrongpass123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText("Invalid username or password")).toBeVisible();
    expect(page.url()).not.toContain("reason=expired");
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByText("Invalid username or password")).toBeHidden({ timeout: 8000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("successful register redirects to /projects", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/register");
    await page.getByLabel("Username").fill("newuser");
    await page.getByLabel("Password", { exact: true }).fill("testpass123");
    await page.getByLabel("Confirm password").fill("testpass123");
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/projects/);
  });

  test("register shows error when passwords do not match", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Username").fill("newuser");
    await page.getByLabel("Password", { exact: true }).fill("testpass123");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test("register shows error when password is too short", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Username").fill("newuser");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });
});

test.describe("Auth – authenticated", () => {
  test("authenticated user visiting /login is redirected to /projects", async ({
    context,
    page,
  }) => {
    await setAuthCookie(context);
    await mockAPI(page);
    await page.goto("/login");
    await page.waitForURL(/\/projects/);
  });

  test("authenticated user visiting /register is redirected to /projects", async ({
    context,
    page,
  }) => {
    await setAuthCookie(context);
    await mockAPI(page);
    await page.goto("/register");
    await page.waitForURL(/\/projects/);
  });
});

