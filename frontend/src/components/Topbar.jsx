import { useEffect, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Badge } from "./UI";

export default function Topbar() {
  const { title } = useWorkspace();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let active = true;
    api.aiStatus()
      .then((result) => {
        if (active) setStatus(result.llm_configured ? "configured" : "fallback");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => { active = false; };
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
      <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-slate-800">{title}</h1>
      <div className="shrink-0" aria-live="polite">
        {status === "checking" && <Badge tone="amber">Checking AI…</Badge>}
        {status === "configured" && <Badge tone="green">AI model configured</Badge>}
        {status === "fallback" && <Badge tone="amber">AI: heuristic fallback</Badge>}
        {status === "unavailable" && <Badge tone="amber">AI status unavailable</Badge>}
      </div>
    </header>
  );
}
