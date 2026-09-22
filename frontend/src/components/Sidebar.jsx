import { useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useUser } from "../context/UserContext";

const NAV = [
  { type: "dashboard", label: "Dashboard", icon: "⌂", guest: true },
  { type: "resume", label: "Resume Maker", icon: "▤", guest: true },
  { type: "jobs", label: "Auto Search & Apply", icon: "⌕", guest: true },
  { type: "joblink", label: "Paste Job Link", icon: "⚭", guest: true },
  { type: "autoapply", label: "Auto-Apply Agent", icon: "▶", guest: true },
  { type: "interview", label: "Interview Coach", icon: "◈", guest: true },
  { type: "tracker", label: "Application Tracker", icon: "☰", guest: false },
  { type: "chat", label: "Career Chat", icon: "◐", guest: false },
  { type: "profile", label: "Profile", icon: "◔", guest: false },
];

export default function Sidebar({ onRequestAuth }) {
  const { page, navigate } = useWorkspace();
  const { userId, user, logout } = useUser();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`app-sidebar flex shrink-0 flex-col border-r border-slate-800/60 bg-gradient-to-b from-slate-950 to-slate-900 text-slate-300 ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm text-white shadow-lg shadow-indigo-900/40">
          ✦
        </span>
        {!collapsed && <div className="brand-copy">
          <p className="text-sm font-bold leading-tight tracking-tight text-white">Career Assistant</p>
          <p className="text-[11px] text-slate-500">AI-powered job search</p>
        </div>}
        <button type="button" className="sidebar-toggle" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>{collapsed ? "›" : "‹"}</button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map(({ type, label, icon, guest }) => {
          const isActive = page === type;
          const locked = !guest && !userId;
          return (
            <button
              key={type}
              onClick={() => (locked ? onRequestAuth() : navigate(type))}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                isActive ? "bg-white text-slate-900 shadow-md" : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`}
            >
              <span className={`w-4 text-center ${isActive ? "text-indigo-600" : "text-slate-500 group-hover:text-indigo-400"}`}>{icon}</span>
              <span className="nav-label flex-1 truncate">{label}</span>
              {locked && <span className="text-[10px] text-slate-600">🔒</span>}
            </button>
          );
        })}
      </nav>

      {!collapsed && <div className="m-3 rounded-xl bg-white/5 p-3 user-panel">
        {userId ? (
          <div className="flex items-center justify-between text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-100">{user?.name || "Signed in"}</p>
              <p className="truncate text-slate-500">{user?.email}</p>
            </div>
            <button onClick={logout} className="shrink-0 text-slate-400 hover:text-indigo-400">out</button>
          </div>
        ) : (
          <>
            <button onClick={onRequestAuth} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-900/40 transition hover:bg-indigo-500">
              Sign in / create account
            </button>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">Browsing as guest — most tools work without one.</p>
          </>
        )}
      </div>}
    </aside>
  );
}
