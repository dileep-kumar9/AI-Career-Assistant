import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Badge } from "./UI";

export default function RightPanel() {
  const { userId } = useUser();
  const { openTab } = useWorkspace();
  const [profile, setProfile] = useState(null);
  const [llmConfigured, setLlmConfigured] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setLlmConfigured(s.llm_configured)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) { setProfile(null); setSummary(null); return; }
    api.getProfile(userId).then(setProfile).catch(() => setProfile(null));
    api.applicationsSummary(userId).then(setSummary).catch(() => {});
  }, [userId]);

  const skills = (profile?.skills || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-slate-200 bg-white/60 p-4 backdrop-blur">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">⚡ AI provider</p>
        {llmConfigured === null ? (
          <p className="text-sm text-slate-400">Checking…</p>
        ) : llmConfigured ? (
          <Badge tone="green">Groq (Llama 3.3) connected</Badge>
        ) : (
          <div>
            <Badge tone="amber">Heuristic fallback</Badge>
            <p className="mt-1.5 text-xs text-slate-500">Get a free key at console.groq.com and set GROQ_API_KEY in backend/.env for live AI output.</p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">✦ Profile snapshot</p>
        {!userId ? (
          <p className="text-sm text-slate-400">Sign in to see your saved skills here.</p>
        ) : skills.length ? (
          <div className="flex flex-wrap gap-1">
            {skills.map((s) => <Badge key={s} tone="indigo">{s}</Badge>)}
          </div>
        ) : (
          <button onClick={() => openTab("profile")} className="text-sm text-indigo-600 hover:underline">
            Add your skills →
          </button>
        )}
      </div>

      {userId && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">💼 Applications</p>
          <p className="text-2xl font-bold text-slate-800">{summary?.total ?? "–"}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {summary && Object.entries(summary.by_status).map(([s, c]) => <Badge key={s}>{s}: {c}</Badge>)}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Quick actions</p>
        <div className="space-y-1.5">
          <button onClick={() => openTab("resume")} className="flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-px hover:shadow-md hover:ring-indigo-300">
            <span className="text-indigo-500">▤</span> Tailor a resume
          </button>
          <button onClick={() => openTab("jobs")} className="flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-px hover:shadow-md hover:ring-indigo-300">
            <span className="text-indigo-500">⌕</span> Find &amp; rank jobs
          </button>
          <button onClick={() => openTab("interview")} className="flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-px hover:shadow-md hover:ring-indigo-300">
            <span className="text-indigo-500">◈</span> Practice interview
          </button>
        </div>
      </div>
    </aside>
  );
}
