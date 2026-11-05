"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { authApi } from "@/lib/api/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await authApi.register({ username, password, display_name: displayName || null });
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = username && password && confirm && !loading;

  return (
    <div className="flex flex-col gap-6">

      {/* Heading */}
      <div>
        <h1 className="text-base font-semibold text-brand">Create account</h1>
        <p className="text-xs mt-1 text-muted-light">
          Set up your requirements engineering workspace.
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
          <label htmlFor="display-name" className="text-xs font-medium text-text-secondary">
            Display name{" "}
            <span className="text-placeholder font-normal">(optional)</span>
          </label>
          <input
            id="display-name"
            aria-label="Display name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Smith"
            className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand placeholder:text-placeholder"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs font-medium text-text-secondary">Password</label>
          <input
            id="password"
            aria-label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand placeholder:text-placeholder"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-xs font-medium text-text-secondary">Confirm password</label>
          <input
            id="confirm-password"
            aria-label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand placeholder:text-placeholder"
          />
        </div>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 px-4 py-2.5 text-sm font-medium rounded-xl text-white transition-all hover:bg-accent-grape disabled:opacity-40 disabled:cursor-default bg-brand"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-xs text-center text-muted-light">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-accent-grape font-medium hover:underline underline-offset-2"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
