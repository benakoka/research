"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CostSummary } from "@/lib/cost";

const links = [
  { href: "/", label: "Home" },
  { href: "/attribution", label: "Attribution" },
  { href: "/rewriting", label: "Rewriting" },
  { href: "/settings", label: "Settings" },
];

function fmtCost(c: number | null) {
  if (c === null) return null;
  return `$${c.toFixed(2)}`;
}

export default function NavClient({ costs }: { costs: CostSummary[] }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-slate-900">
            AI Transmission Chain Pilot
          </span>
          <nav className="flex gap-4">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    "text-sm font-medium " +
                    (active
                      ? "text-slate-900 underline"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          {costs.map((c) => (
            <div key={c.model} className="text-right leading-tight">
              <div className="font-mono">
                {c.model}: {c.snapshot || <span className="italic">no snapshot set</span>}
              </div>
              <div>
                {c.calls} calls
                {fmtCost(c.estimatedCostUsd) ? ` · ~${fmtCost(c.estimatedCostUsd)}` : ""}
              </div>
            </div>
          ))}
          <button
            onClick={logout}
            className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
