"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { authApi } from "@/lib/api/auth";

const ERROR_VISIBLE_MS = 5000;

function SessionExpiredBanner() {
  const reason = useSearchParams().get("reason");
  if (reason !== "expired") return null;
  return (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
      Your session has expired. Please sign in again.
    </p>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.login({ username, password });
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Heading */}
      <div>
        <h1 className="text-base font-semibold text-brand">Sign in</h1>
        <p className="text-xs mt-1 text-muted-light">
          Continue to your requirements workspace.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="username" className="text-xs font-medium text-text-secondary">Username</label>
          <input
            id="username"
            aria-label="Username"
            type="text"
            autoComplete="username"
            required
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourusername"
            className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand placeholder:text-placeholder"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs font-medium text-text-secondary">Password</label>
          <input
            id="password"
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand placeholder:text-placeholder"
          />
        </div>

        <Suspense>
          <SessionExpiredBanner />
        </Suspense>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="mt-1 px-4 py-2.5 text-sm font-medium rounded-xl text-white transition-all hover:bg-accent-grape disabled:opacity-40 disabled:cursor-default bg-brand"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-xs text-center text-muted-light">
        No account?{" "}
        <Link
          href="/register"
          className="text-accent-grape font-medium hover:underline underline-offset-2"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
