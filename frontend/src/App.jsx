import { useEffect, useState } from "react";
import { UserProvider } from "./context/UserContext";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import AuthModal from "./components/AuthModal";

import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Resume from "./pages/Resume";
import Jobs from "./pages/Jobs";
import JobLink from "./pages/JobLink";
import AutoApply from "./pages/AutoApply";
import Tracker from "./pages/Tracker";
import Interview from "./pages/Interview";
import Chat from "./pages/Chat";

const PAGES = {
  dashboard: Dashboard,
  profile: Profile,
  resume: Resume,
  jobs: Jobs,
  joblink: JobLink,
  autoapply: AutoApply,
  tracker: Tracker,
  interview: Interview,
  chat: Chat,
};

function Workbench({ onRequestAuth, theme, onToggleTheme }) {
  const { page, params, navigate } = useWorkspace();
  const Page = PAGES[page] || Dashboard;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <Sidebar onRequestAuth={onRequestAuth} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar theme={theme} onToggleTheme={onToggleTheme} />
        <main className="min-w-0 flex-1 overflow-y-auto p-5 md:p-8">
          <div className="mx-auto w-full max-w-[1440px]">
            <Page params={params} onRequestAuth={onRequestAuth} navigate={navigate} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("aca-theme") || "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aca-theme", theme);
  }, [theme]);
  return (
    <UserProvider>
      <WorkspaceProvider>
        <Workbench theme={theme} onToggleTheme={() => setTheme((t) => t === "light" ? "dark" : "light")} onRequestAuth={() => setAuthOpen(true)} />
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </WorkspaceProvider>
    </UserProvider>
  );
}
