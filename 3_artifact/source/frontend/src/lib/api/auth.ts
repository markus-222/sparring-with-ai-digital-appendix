import type { LoginRequest, RegisterRequest, User } from "@/types";
import { fetchAPI } from "./fetcher";

export const authApi = {
  register: (body: RegisterRequest): Promise<User> =>
    fetchAPI<User>("/auth/register", { method: "POST", body: JSON.stringify(body) }),

  login: (body: LoginRequest): Promise<User> =>
    fetchAPI<User>("/auth/login", { method: "POST", body: JSON.stringify(body) }),

  logout: (): Promise<void> =>
    fetchAPI<void>("/auth/logout", { method: "POST" }),

  me: (): Promise<User> =>
    fetchAPI<User>("/auth/me"),

  updateProfile: (displayName: string | null): Promise<User> =>
    fetchAPI<User>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ display_name: displayName }),
    }),
};
