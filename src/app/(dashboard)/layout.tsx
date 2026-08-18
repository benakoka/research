import { getSettings, getUsage } from "@/lib/store";
import { summarizeCost } from "@/lib/cost";
import NavClient from "./NavClient";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSettings();
  const usage = await getUsage();
  const costs = summarizeCost(usage, settings);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-slate-50">
      <NavClient costs={costs} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
