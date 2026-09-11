import { Sidebar } from "@/components/app/sidebar";
import { currentVersion, productName } from "@/lib/update/check";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar version={currentVersion()} productName={productName()} />
      <main className="ml-[240px]">
        <div className="max-w-[1200px] mx-auto px-12 py-12">{children}</div>
      </main>
    </div>
  );
}
