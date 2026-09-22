import { NavLink } from "react-router-dom";
import { useUser } from "../context/UserContext";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/profile", label: "Profile" },
  { to: "/resume", label: "Resume" },
  { to: "/jobs", label: "Job Discovery" },
  { to: "/job-link", label: "Paste Job Link" },
  { to: "/tracker", label: "Tracker" },
  { to: "/interview", label: "Interview" },
  { to: "/chat", label: "Career Chat" },
];

export default function NavBar() {
  const { user, logout } = useUser();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-indigo-600">AI Career Assistant</span>
        </div>
        <nav className="flex flex-wrap gap-1 text-sm">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 font-medium transition ${
                  isActive ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="text-sm text-slate-500">
          {user ? (
            <span className="flex items-center gap-2">
              {user.name}
              <button onClick={logout} className="text-indigo-600 hover:underline">
                switch user
              </button>
            </span>
          ) : (
            <span>Not signed in</span>
          )}
        </div>
      </div>
    </header>
  );
}
