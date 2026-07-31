"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icons";
import { LogoIconChip } from "@/components/Logo";

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
      className={`fixed inset-y-0 left-0 flex flex-col border-r border-line/70 bg-panel ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div
        className={`flex items-center px-4 pb-4 pt-5 ${
          collapsed ? "flex-col gap-3 px-0" : "justify-between"
        }`}
      >
        {collapsed ? (
          <LogoIconChip />
        ) : (
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <LogoIconChip />
            <span className="truncate text-base font-bold tracking-[-0.01em] text-ink">
              Spine Scale
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-[10px] p-2 text-muted hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          <Icon
            name="chevronLeft"
            className={`h-4 w-4 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {!collapsed && (
        <div className="px-6 pb-2 pt-2 text-xs font-medium tracking-[0.02em] text-muted">
          Internal ops
        </div>
      )}
      <nav className={`flex-1 space-y-1 py-1 ${collapsed ? "px-2" : "px-3"}`}>
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
              className={`flex h-[42px] items-center gap-3 rounded-[10px] text-sm font-medium ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-wash hover:text-ink"
              }`}
            >
              <Icon name={item.icon} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      <form
        action={logout}
        className={`border-t border-line/60 py-3 ${collapsed ? "px-2" : "px-3"}`}
      >
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={`flex h-[42px] w-full items-center gap-3 rounded-[10px] text-left text-sm font-medium text-muted hover:bg-wash hover:text-ink ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
        >
          <Icon name="logout" />
          {!collapsed && "Sign out"}
        </button>
      </form>
    </aside>
  );
}
