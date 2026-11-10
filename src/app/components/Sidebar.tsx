"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FolderPlus, Home, LogOut, Menu, Plus, Repeat, Settings, X } from "lucide-react";
import { logOut } from "../actions/auth";
import { folderHex } from "@/lib/folderColors";
import Logo from "./Logo";
import NewFolderDialog from "./NewFolderDialog";
import StatusPill from "./StatusPill";
import ThemeToggle from "./ThemeToggle";

export interface SidebarFolder {
  id: string;
  name: string;
  color: string;
  projectCount: number;
}

interface Props {
  user: { name: string; email: string };
  folders: SidebarFolder[];
  dueCount: number;
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-subtle font-medium text-ink" : "text-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function SidebarBody({ user, folders, dueCount, onNewFolder }: Props & { onNewFolder: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <Logo href="/dashboard" />
      </div>
      <div className="px-3">
        <Link href="/projects/new" className="btn btn-primary w-full justify-start">
          <Plus className="size-4" /> New project
        </Link>
      </div>

      <nav className="mt-4 space-y-0.5 px-3" aria-label="Main">
        <NavLink href="/dashboard" active={pathname === "/dashboard"}>
          <Home className="size-4" /> Home
        </NavLink>
        <NavLink href="/review" active={pathname.startsWith("/review")}>
          <Repeat className="size-4" /> Review
          {dueCount > 0 && (
            <span className="ml-auto rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-ink tabular-nums">
              {dueCount > 99 ? "99+" : dueCount}
            </span>
          )}
        </NavLink>
        <NavLink href="/settings" active={pathname.startsWith("/settings")}>
          <Settings className="size-4" /> Settings
        </NavLink>
      </nav>

      <div className="mt-6 flex items-center justify-between px-5">
        <span className="eyebrow">Folders</span>
        <button type="button" onClick={onNewFolder} className="icon-btn size-7" aria-label="New folder" title="New folder">
          <FolderPlus className="size-4" />
        </button>
      </div>
      <nav className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Folders">
        {folders.length === 0 && (
          <button type="button" onClick={onNewFolder} className="w-full rounded-md px-2.5 py-2 text-left text-sm text-faint hover:bg-subtle hover:text-ink">
            Create a folder for each class
          </button>
        )}
        {folders.map((f) => (
          <NavLink key={f.id} href={`/folders/${f.id}`} active={pathname === `/folders/${f.id}`}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: folderHex(f.color) }} />
            <span className="truncate">{f.name}</span>
            <span className="ml-auto text-xs text-faint tabular-nums">{f.projectCount}</span>
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-line px-4 py-3">
        <StatusPill />
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-faint">{user.email}</p>
          </div>
          <form action={logOut}>
            <button type="submit" className="icon-btn" aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}

export default function Sidebar(props: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  // Close the mobile drawer whenever the page changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to navigation
    setMobileOpen(false);
  }, [pathname]);

  const openFolderDialog = () => {
    setMobileOpen(false);
    setFolderOpen(true);
  };

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-surface lg:block">
        <SidebarBody {...props} onNewFolder={openFolderDialog} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-3 py-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} className="icon-btn" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Logo href="/dashboard" />
        <Link href="/projects/new" className="icon-btn" aria-label="New project">
          <Plus className="size-5" />
        </Link>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-xl animate-fade-in">
            <button type="button" onClick={() => setMobileOpen(false)} className="icon-btn absolute top-3 right-3" aria-label="Close menu">
              <X className="size-4" />
            </button>
            <SidebarBody {...props} onNewFolder={openFolderDialog} />
          </div>
        </div>
      )}

      <NewFolderDialog open={folderOpen} onClose={() => setFolderOpen(false)} />
    </>
  );
}
