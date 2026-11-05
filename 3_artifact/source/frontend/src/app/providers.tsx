"use client";

import { SWRConfig } from "swr";
import { SessionProvider } from "@/providers/SessionProvider";

const SWR_CONFIG = {
  revalidateOnFocus: false,
  dedupingInterval: 2000,
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={SWR_CONFIG}>
      <SessionProvider>{children}</SessionProvider>
    </SWRConfig>
  );
}
