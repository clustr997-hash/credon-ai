"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "@/lib/api";
import { CredonLogo } from "@/components/logo";
import {
  IconBook,
  IconDownload,
  IconLogout,
  IconPanelLeft,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUser,
  IconX,
} from "./icons";

function IconCheckCircle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5.5" />
    </svg>
  );
}

function groupLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "Earlier";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function Sidebar({
  variant,
  collapsed,
  onToggleCollapse,
  open,
  onCloseMobile,
  sessions,
  currentSessionId,
  isGuest,
  userName,
  userEmail,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenKnowledge,
  onOpenTasks,
  onOpenDownloads,
  onOpenProfile,
  onSignOut,
  onGoHome,
}: {
  variant: "desktop" | "mobile";
  collapsed: boolean;
  onToggleCollapse: () => void;
  open?: boolean;
  onCloseMobile?: () => void;
  sessions: SessionSummary[];
  currentSessionId: string;
  isGuest: boolean;
  userName: string;
  userEmail: string;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenKnowledge: () => void;
  onOpenTasks: () => void;
  onOpenDownloads: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  onGoHome: () => void;
}) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = useMemo(
    () => sessions.filter((s) => s.preview.toLowerCase().includes(search.toLowerCase())),
    [sessions, search]
  );

  const groups = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of filtered) {
      const label = groupLabel(session.last_updated);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(session);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const width = collapsed ? 62 : 270;

  const content = (
    <div className="flex h-full flex-col" style={{ background: "var(--bg-subtle)" }}>
      {/* brand header */}
      <div className={`flex items-center gap-1.5 px-3 pt-3.5 ${collapsed ? "justify-center" : ""}`}>
        {!collapsed && (
          <button onClick={onGoHome} className="min-w-0 flex-1 text-left" title="Credon AI home">
            <CredonLogo size={24} />
          </button>
        )}
        <button
          onClick={variant === "desktop" ? onToggleCollapse : onCloseMobile}
          aria-label={variant === "mobile" ? "Close menu" : "Toggle sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.04]"
          style={{ color: "var(--text-faint)" }}
        >
          {variant === "mobile" ? <IconX size={17} /> : <IconPanelLeft size={16} />}
        </button>
      </div>

      {/* new chat */}
      <div className={`px-3 pb-1 pt-3 ${collapsed ? "flex justify-center" : ""}`}>
        <button
          onClick={onNewChat}
          title="New chat (⌘K)"
          className={`flex items-center gap-2 rounded-xl text-[13px] font-medium text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md ${
            collapsed ? "h-10 w-10 justify-center" : "w-full px-3 py-2.5"
          }`}
          style={{ background: "var(--accent)" }}
        >
          <IconPlus size={15} />
          {!collapsed && "New chat"}
        </button>
      </div>

      {/* search */}
      {!collapsed && (
        <div className="px-3 pb-2 pt-2">
          <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <span style={{ color: "var(--text-faint)" }}>
              <IconSearch size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--text-faint)]"
              style={{ color: "var(--text)" }}
            />
          </div>
        </div>
      )}

      {/* grouped sessions */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {collapsed ? (
          <ul className="space-y-1 pt-2">
            {sessions.slice(0, 8).map((session) => {
              const active = session.session_id === currentSessionId;
              return (
                <li key={session.session_id}>
                  <button
                    onClick={() => onSelectSession(session.session_id)}
                    title={session.preview}
                    aria-label={session.preview}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.04]"
                    style={{ color: active ? "var(--accent-text)" : "var(--text-faint)" }}
                  >
                    <span className="text-[11px]">{session.preview.charAt(0).toUpperCase() || "·"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            {groups.map(([label, items]) => (
              <div key={label} className="pb-1">
                <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-faint)" }}>
                  {label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((session) => {
                    const active = session.session_id === currentSessionId;
                    return (
                      <li key={session.session_id} className="group/item relative">
                        <button
                          onClick={() => onSelectSession(session.session_id)}
                          title={session.preview}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.035]"
                          style={
                            active
                              ? { background: "var(--surface-2)", color: "var(--text)" }
                              : { color: "var(--text-dim)" }
                          }
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: active ? "var(--accent)" : "var(--border-strong)" }} />
                          <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">
                            {session.preview || "Untitled chat"}
                          </span>
                        </button>
                        {confirmDelete === session.session_id ? (
                          <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-lg border px-1 py-0.5" style={{ borderColor: "var(--border-strong)", background: "var(--surface-3)" }}>
                            <button
                              onClick={() => { onDeleteSession(session.session_id); setConfirmDelete(null); }}
                              className="rounded px-1.5 py-0.5 text-[11px]"
                              style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}
                            >
                              Delete
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 text-[11px]" style={{ color: "var(--text-dim)" }}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(session.session_id)}
                            aria-label="Delete chat"
                            className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md group-hover/item:flex hover:bg-white/[0.06]"
                            style={{ color: "var(--text-faint)" }}
                          >
                            <IconTrash size={13} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="mt-4 px-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
                {sessions.length === 0 ? "No chats yet — start a conversation." : "No chats match your search."}
              </p>
            )}
          </>
        )}
      </nav>

      {/* footer */}
      <div className="space-y-0.5 border-t p-3" style={{ borderColor: "var(--border)" }}>
        <SidebarAction icon={<IconBook size={16} />} label="Knowledge & PDFs" collapsed={collapsed} onClick={onOpenKnowledge} />
        <SidebarAction icon={<IconCheckCircle size={16} />} label="Tasks" collapsed={collapsed} onClick={onOpenTasks} />
        <SidebarAction icon={<IconDownload size={16} />} label="Export center" collapsed={collapsed} onClick={onOpenDownloads} />
        <SidebarAction
          icon={<IconUser size={16} />}
          label={isGuest ? "Guest session" : userName || "Profile"}
          sub={!collapsed && !isGuest ? userEmail : undefined}
          collapsed={collapsed}
          onClick={onOpenProfile}
        />
        {!isGuest ? (
          <SidebarAction icon={<IconLogout size={16} />} label="Sign out" collapsed={collapsed} onClick={onSignOut} />
        ) : (
          <a href="/login" className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-white/[0.04] ${collapsed ? "justify-center" : ""}`} style={{ color: "var(--accent-text)" }}>
            <IconLogout size={16} />
            {!collapsed && "Sign in to sync"}
          </a>
        )}
      </div>
    </div>
  );

  if (variant === "desktop") {
    return (
      <aside className="relative hidden shrink-0 border-r transition-[width] duration-300 ease-out lg:block" style={{ width, borderColor: "var(--border)" }}>
        <div className="fixed bottom-0 left-0 top-0" style={{ width }}>{content}</div>
      </aside>
    );
  }

  return (
    <>
      <div
        onClick={onCloseMobile}
        className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        className={`fixed bottom-0 left-0 top-0 z-50 w-[286px] border-r transition-transform duration-300 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ borderColor: "var(--border)", transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
      >
        {content}
      </aside>
    </>
  );
}

function SidebarAction({
  icon,
  label,
  sub,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.04] ${collapsed ? "justify-center" : ""}`}
      style={{ color: "var(--text-dim)" }}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && (
        <span className="min-w-0 truncate">
          {label}
          {sub && <span className="block truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{sub}</span>}
        </span>
      )}
    </button>
  );
}
