"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSettings } from "@/lib/clientStorage";

const links = [
  { href: "/", label: "Home" },
  { href: "/attribution", label: "Attribution" },
  { href: "/rewriting", label: "Rewriting" },
  { href: "/settings", label: "Settings" },
];

export default function NavClient() {
  const pathname = usePathname();
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<{ gpt: string; gemini: string } | null>(null);

  useEffect(() => {
    function refresh() {
      const settings = getSettings();
      setSnapshots({ gpt: settings.gptModelSnapshot, gemini: settings.geminiModelSnapshot });
    }
    refresh();
    // The layout stays mounted across client-side navigations, so this
    // polls to stay current if the snapshot strings change on Settings
    // (a same-tab localStorage write doesn't fire the `storage` event,
    // only cross-tab writes do).
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

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
          {snapshots && (
            <div className="text-right font-mono leading-tight">
              <div>GPT: {snapshots.gpt || <span className="italic">no snapshot set</span>}</div>
              <div>Gemini: {snapshots.gemini || <span className="italic">no snapshot set</span>}</div>
            </div>
          )}
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
