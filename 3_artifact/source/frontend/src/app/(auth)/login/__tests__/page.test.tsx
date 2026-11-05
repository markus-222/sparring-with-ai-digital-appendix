import { act, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw-server";
import { API } from "@/lib/api/fetcher";
import LoginPage from "../page";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function submitWrongPassword(): Promise<void> {
  server.use(
    http.post(`${API}/auth/login`, () =>
      HttpResponse.json({ detail: "Invalid username or password" }, { status: 401 }),
    ),
  );
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "testuser" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpass1" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  });
}

describe("LoginPage", () => {
  it("shows the backend message after a wrong password and stays on the form", async () => {
    await submitWrongPassword();

    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("hides the error again after a few seconds", async () => {
    await submitWrongPassword();
    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Invalid username or password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("testuser");
  });
});
