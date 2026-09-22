import { useState } from "react";
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

function Workbench({ onRequestAuth }) {
  const { page, params, navigate } = useWorkspace();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const Page = PAGES[page] || Dashboard;

  return (
    <div className="app-shell flex h-[100dvh] w-screen overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-slate-950/60 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Sidebar
        onRequestAuth={onRequestAuth}
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-3 border-b border-slate-200/70 bg-white/90 px-4 py-2 md:hidden">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            ☰ <span className="ml-1">Menu</span>
          </button>
          <span className="truncate text-sm font-semibold text-slate-800">Career Assistant</span>
        </div>
        <Topbar />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Page params={params} onRequestAuth={onRequestAuth} navigate={navigate} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [authOpen, setAuthOpen] = useState(false);
  return (
    <UserProvider>
      <WorkspaceProvider>
        <Workbench onRequestAuth={() => setAuthOpen(true)} />
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </WorkspaceProvider>
    </UserProvider>
  );
}
