"use client";

import { useState } from "react";
import { authApi } from "@/lib/api/auth";
import { X, User as UserIcon } from "lucide-react";
import type { User } from "@/types";

interface ProfileEditModalProps {
  user: User;
  onClose: () => void;
  onUpdate: (user: User) => void;
}

export function ProfileEditModal({
  user,
  onClose,
  onUpdate,
}: ProfileEditModalProps) {
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      const updated = await authApi.updateProfile(
        displayName.trim() || null
      );
      onUpdate(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(15,23,42,0.3)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-2xl p-8 flex flex-col gap-5 w-full mx-4"
        style={{ maxWidth: 440, boxShadow: "0 8px 40px rgba(30,25,75,0.12)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-brand-light">
              <UserIcon size={20} className="text-brand" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-brand">Edit profile</h2>
              <p className="text-xs mt-1 text-muted-light">
                Update your display name.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-input-bg rounded-lg transition-colors"
          >
            <X size={16} className="text-muted-text" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Display name
            </label>
            <input
              autoFocus
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSaving) {
                  handleSave();
                }
              }}
              className="text-sm px-3 py-2.5 rounded-xl outline-none transition-all border border-input-border text-brand bg-input-surface focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Username
            </label>
            <div className="text-sm px-3 py-2.5 rounded-xl border border-input-border text-muted-text bg-panel">
              {user.username}
            </div>
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm rounded-xl transition-colors hover:bg-input-bg text-text-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 text-sm font-medium rounded-xl text-white transition-colors ${
              isSaving
                ? "bg-placeholder cursor-default"
                : "bg-brand cursor-pointer hover:bg-accent-grape"
            }`}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
