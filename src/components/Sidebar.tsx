"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <path d="M3 3h7v9H3V3zm11 0h7v5h-7V3zm0 9h7v9h-7v-9zM3 16h7v5H3v-5z" />
  ),
  pipeline: (
    <path d="M4 4h16v3H4V4zm2 6.5h12v3H6v-3zM8 17h8v3H8v-3z" />
  ),
  clients: (
    <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-8 8a8 8 0 0116 0v1H4v-1z" />
  ),
  reporting: (
    <path d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z" />
  ),
  library: (
    <path d="M4 3h5v18H4V3zm7 0h5v18h-5V3zm7.2.6l3.4 17-4.9 1L13.3 4.5l4.9-.9z" />
  ),
};

const NAV = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { href: "/reporting", label: "Reporting", icon: "reporting" },
  { href: "/library", label: "Library", icon: "library" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 flex w-52 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-4">
        <div className="text-sm font-bold tracking-tight">Spine Scale</div>
        <div className="text-[11px] text-muted">Internal Ops</div>
      </div>
      <nav className="flex-1 py-2">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 border-l-2 px-4 py-2 text-sm ${
                active
                  ? "border-accent bg-bg font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 ${active ? "fill-accent" : "fill-current"}`}
                aria-hidden
              >
                {ICONS[item.icon]}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <form action={logout} className="border-t border-line">
        <button
          type="submit"
          className="w-full px-4 py-3 text-left text-sm text-muted hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </aside>
  );
}
