import { useEffect, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Badge } from "./UI";

export default function Topbar() {
  const { title } = useWorkspace();
  const [llmConfigured, setLlmConfigured] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setLlmConfigured(s.llm_configured)).catch(() => {});
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold tracking-tight text-slate-800">{title}</h1>
      <div>
        {llmConfigured === null ? null : llmConfigured ? (
          <Badge tone="green">Groq (Llama 3.3) connected</Badge>
        ) : (
          <Badge tone="amber">AI: heuristic fallback</Badge>
        )}
      </div>
    </header>
  );
}
