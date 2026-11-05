import { AppHeader } from "@/components/layout/AppHeader";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen overflow-hidden">
      <AppHeader />
      <div className="flex h-full overflow-hidden bg-surface pt-[52px]">
        {children}
      </div>
    </div>
  );
}
