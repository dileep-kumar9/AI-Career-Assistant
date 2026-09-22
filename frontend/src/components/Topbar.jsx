import { useEffect, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Badge } from "./UI";

export default function Topbar({ theme = "light", onToggleTheme = () => {} }) {
  const { title } = useWorkspace();
  const [llmConfigured, setLlmConfigured] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setLlmConfigured(s.llm_configured)).catch(() => {});
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold tracking-tight text-slate-800">{title}</h1>
      <div className="topbar-actions">
        {llmConfigured === null ? <span className="status-pill">Checking AI…</span> : llmConfigured ? (
          <Badge tone="green">AI connected</Badge>
        ) : (
          <Badge tone="amber">Fallback mode</Badge>
        )}
        <button type="button" className="theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Change appearance">
          <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span><span>{theme === "light" ? "Dark" : "Light"}</span>
        </button>
      </div>
    </header>
  );
}
