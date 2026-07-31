"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { LogoIconChip, LogoWordmarkChip } from "@/components/Logo";

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

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside
      className={`fixed inset-y-0 left-0 flex flex-col border-r border-line bg-surface ${
        collapsed ? "w-16" : "w-52"
      }`}
    >
      <div
        className={`flex items-center border-b border-line px-3 py-3 ${
          collapsed ? "flex-col gap-2" : "justify-between"
        }`}
      >
        {collapsed ? (
          <LogoIconChip />
        ) : (
          <Link href="/" className="min-w-0">
            <LogoWordmarkChip />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 fill-current ${collapsed ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="M15.4 6.4L14 5l-7 7 7 7 1.4-1.4L9.8 12l5.6-5.6z" />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted">
          Internal Ops
        </div>
      )}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:bg-bg hover:text-ink"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 fill-current"
                aria-hidden
              >
                {ICONS[item.icon]}
              </svg>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      <form action={logout} className="border-t border-line p-2">
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted hover:bg-bg hover:text-ink ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden>
            <path d="M10 3h8a1 1 0 011 1v16a1 1 0 01-1 1h-8v-2h7V5h-7V3zm1.5 5.5L15 12l-3.5 3.5-1.4-1.4 1.1-1.1H4v-2h7.2l-1.1-1.1 1.4-1.4z" />
          </svg>
          {!collapsed && "Sign out"}
        </button>
      </form>
    </aside>
  );
}
