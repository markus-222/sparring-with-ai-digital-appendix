import { toApiError } from "@/lib/api/errors";

// === Base Config ===
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const API = `${API_BASE}/api/v1`;

const CREDENTIAL_ENDPOINTS: readonly string[] = ["/auth/login", "/auth/register"];

/** A 401 from the credential endpoints means wrong input, not an expired session. */
export function redirectsOnUnauthorized(endpoint: string): boolean {
  return !CREDENTIAL_ENDPOINTS.includes(endpoint);
}

function redirectToLogin(): void {
  if (typeof window !== "undefined") {
    window.location.href = "/login?reason=expired";
  }
}

// === Fetcher for SWR ===
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) {
      redirectToLogin();
    }
    throw await toApiError(res);
  }
  return res.json();
}

// === Typed fetch helper for mutations ===
export async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401 && redirectsOnUnauthorized(endpoint)) {
      redirectToLogin();
    }
    throw await toApiError(res);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
