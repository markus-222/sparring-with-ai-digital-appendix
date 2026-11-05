"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { API, fetcher } from "@/lib/api/fetcher";
import { authApi } from "@/lib/api/auth";
import { SessionTimeoutModal } from "@/components/auth/SessionTimeoutModal";
import type { User } from "@/types";

interface SessionContextType {
  isExpiring: boolean;
  timeUntilExpiry: number;
  extendSession: () => void;
  isLoggedIn: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const WARNING_SECONDS = 2 * 60; // show warning 2 minutes before expiry

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/register";

  // Share the same SWR cache key as useCurrentUser() — no extra request
  const { data: user, mutate: mutateUser } = useSWR<User>(
    !isAuthPage ? `${API}/auth/me` : null,
    fetcher,
  );

  const [timeUntilExpiry, setTimeUntilExpiry] = useState(0);
  const [isExpiring, setIsExpiring] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // The actual expiry comes directly from the JWT — single source of truth
  const expiresAt = user?.session_expires_at ?? null;

  const performLogout = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsExpiring(false);
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    router.push("/login?reason=expired");
  };

  // Calling /auth/me triggers the sliding-window refresh on the backend,
  // which issues a new token with a fresh session_expires_at
  const extendSession = async () => {
    setIsExpiring(false);
    await mutateUser();
  };

  // Restart the countdown whenever the token expiry changes (login, refresh, etc.)
  useEffect(() => {
    if (isAuthPage || !expiresAt) return;

    if (intervalRef.current) clearInterval(intervalRef.current);

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setTimeUntilExpiry(remaining);

      if (remaining <= 0) {
        clearInterval(intervalRef.current!);
        performLogout();
      } else if (remaining <= WARNING_SECONDS) {
        setIsExpiring(true);
      } else {
        setIsExpiring(false);
      }
    };

    tick(); // run immediately so UI is correct before first interval fires
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt, isAuthPage]);

  const isLoggedIn = !isAuthPage && !!user;

  return (
    <SessionContext.Provider
      value={{ isExpiring, timeUntilExpiry, extendSession, isLoggedIn }}
    >
      {children}
      {isExpiring && isLoggedIn && (
        <SessionTimeoutModal
          timeRemaining={timeUntilExpiry}
          onExtend={extendSession}
        />
      )}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
