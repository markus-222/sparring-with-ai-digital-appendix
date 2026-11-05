"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useProject, useCurrentUser } from "@/lib/api";
import { authApi } from "@/lib/api/auth";
import { FolderOpen, LogOut, User as UserIcon } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ProfileEditModal } from "@/components/auth/ProfileEditModal";

function initials(displayName: string | null | undefined, username: string): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 2).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

export function AppHeader() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string | undefined;
  const { data: project } = useProject(projectId ?? null);
  const { data: user, mutate: mutateUser } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await authApi.logout();
    } catch {
      // ignore — cookie cleared server-side
    }
    router.push("/login");
  }

  return (
    <>
      <header className="flex items-center px-5 shrink-0 gap-3 h-[52px] fixed top-0 inset-x-0 z-50 bg-white/30 backdrop-blur-lg border-b border-[#CBBFFB]/30 transition-all">
        {/* Left: logo + breadcrumb */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Link
            href="/projects"
            className="flex items-center gap-2 shrink-0 hover:opacity-70 transition-opacity"
          >
            <div className="w-6 h-6 rounded-[5px] flex items-center justify-center bg-brand">
              <FolderOpen size={12} strokeWidth={2} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-brand">AiRE</span>
          </Link>
          {project && (
            <>
              <span className="shrink-0 select-none px-1 text-breadcrumb">/</span>
              <span className="text-sm truncate text-muted-text">{project.name}</span>
            </>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setMenuOpen((o) => !o)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold bg-brand hover:bg-accent-grape transition-colors cursor-pointer"
              aria-label="User menu"
            >
              {user ? initials(user.display_name, user.username) : "…"}
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                className="absolute top-full right-0 mt-2 w-56 rounded-xl bg-white border border-[#F0EDF8] overflow-hidden z-50"
                style={{ boxShadow: "0 10px 25px rgba(0,0,0,0.12)" }}
              >
                <div className="px-4 py-3 border-b border-[#F0EDF8]">
                  <p className="text-sm font-semibold text-brand truncate">
                    {user?.display_name ?? "—"}
                  </p>
                  <p className="text-xs truncate mt-0.5 text-muted-light">
                    {user?.username ?? ""}
                  </p>
                </div>
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditingProfile(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-text hover:bg-[#F6F4FB] hover:text-brand transition-colors"
                  >
                    <UserIcon size={14} strokeWidth={1.75} />
                    Edit profile
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-text hover:bg-[#F6F4FB] hover:text-brand transition-colors"
                  >
                    <LogOut size={14} strokeWidth={1.75} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {editingProfile && user && (
        <ProfileEditModal
          user={user}
          onClose={() => setEditingProfile(false)}
          onUpdate={(updated) => {
            mutateUser(updated);
          }}
        />
      )}
    </>
  );
}
