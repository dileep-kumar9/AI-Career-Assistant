import { createContext, useContext, useState, useCallback } from "react";

const WorkspaceContext = createContext(null);

const TITLES = {
  dashboard: "Dashboard",
  profile: "Profile",
  resume: "Resume Maker",
  jobs: "Auto Search & Apply",
  joblink: "Paste Job Link",
  autoapply: "Auto-Apply",
  tracker: "Tracker",
  interview: "Interview Coach",
  chat: "Career Chat",
};

export function WorkspaceProvider({ children }) {
  const [page, setPage] = useState("dashboard");
  const [params, setParams] = useState({});

  const navigate = useCallback((type, nextParams = {}) => {
    setPage(type);
    setParams(nextParams);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ page, params, title: TITLES[page] || page, navigate }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
