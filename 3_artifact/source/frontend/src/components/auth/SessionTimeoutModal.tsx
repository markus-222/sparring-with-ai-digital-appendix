"use client";

import { AlertCircle } from "lucide-react";

interface SessionTimeoutModalProps {
  timeRemaining: number;
  onExtend: () => void;
}

export function SessionTimeoutModal({
  timeRemaining,
  onExtend,
}: SessionTimeoutModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(15,23,42,0.5)" }}
    >
      <div
        className="bg-white rounded-2xl p-8 flex flex-col gap-5 w-full mx-4"
        style={{ maxWidth: 440, boxShadow: "0 8px 40px rgba(30,25,75,0.12)" }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-yellow-50">
            <AlertCircle size={20} className="text-yellow-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-brand">
              Session expiring soon
            </h2>
            <p className="text-xs mt-1 text-muted-light">
              Your session will expire in {timeRemaining} seconds due to
              inactivity.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={() => {
              // Allow logout without extending
              window.location.href = "/login?reason=expired";
            }}
            className="px-4 py-2 text-sm rounded-xl transition-colors hover:bg-input-bg text-text-secondary"
          >
            Logout
          </button>
          <button
            onClick={onExtend}
            className="px-4 py-2 text-sm font-medium rounded-xl text-white transition-colors bg-brand cursor-pointer hover:bg-accent-grape"
          >
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
