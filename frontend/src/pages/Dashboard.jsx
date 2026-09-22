import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Card, Badge, Button } from "../components/UI";

const ACTIONS = [
  { type: "resume", title: "Tailor a resume", desc: "Paste a JD, get an ATS-optimized rewrite in seconds.", icon: "▤", guest: true },
  { type: "jobs", title: "Auto search & apply", desc: "Find open roles, ranked by how well they match you.", icon: "⌕", guest: true },
  { type: "autoapply", title: "Run the Apply Agent", desc: "Auto-fill an application, pausing before you submit.", icon: "▶", guest: true },
  { type: "interview", title: "Practice an interview", desc: "Typing or voice, with real-time feedback.", icon: "◈", guest: true },
];

export default function Dashboard({ onRequestAuth }) {
  const { userId, user } = useUser();
  const { navigate } = useWorkspace();
  const [summary, setSummary] = useState(null);
  const [profile, setProfile] = useState(null);
  const [resumeCount, setResumeCount] = useState(null);
  const [llmConfigured, setLlmConfigured] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setLlmConfigured(s.llm_configured)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) { setSummary(null); setProfile(null); setResumeCount(null); return; }
    api.applicationsSummary(userId).then(setSummary).catch(() => {});
    api.getProfile(userId).then(setProfile).catch(() => setProfile(null));
    api.listResumes(userId).then((r) => setResumeCount(r.length)).catch(() => {});
  }, [userId]);

  const skills = (profile?.skills || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 14);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 px-6 py-8 text-white shadow-lg shadow-indigo-900/20">
        <p className="text-sm font-medium text-indigo-200">Welcome{user ? "" : " to your"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{user ? `${user.name}'s career workspace` : "AI Career Assistant"}</h1>
        <p className="mt-2 max-w-xl text-sm text-indigo-100">
          Tailor resumes to any job description, discover and rank real openings, practice interviews, and let the apply agent handle the busywork on application forms.
        </p>
        {!userId && (
          <Button onClick={onRequestAuth} className="mt-4 bg-white text-indigo-700 hover:bg-indigo-50">
            Sign in / create account
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Applications">
          <p className="text-3xl font-bold text-indigo-600">{summary?.total ?? (userId ? "–" : "—")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary && Object.entries(summary.by_status).map(([status, count]) => (
              <Badge key={status} tone="indigo">{status}: {count}</Badge>
            ))}
            {!userId && <p className="text-xs text-slate-400">Sign in to track applications.</p>}
          </div>
        </Card>
        <Card title="Resumes">
          <p className="text-3xl font-bold text-indigo-600">{resumeCount ?? (userId ? "–" : "—")}</p>
          <p className="mt-1 text-sm text-slate-500">{userId ? "Master + tailored versions saved" : "Sign in to save versions"}</p>
        </Card>
        <Card title="AI provider">
          {llmConfigured === null ? (
            <p className="text-sm text-slate-400">Checking…</p>
          ) : llmConfigured ? (
            <Badge tone="green">Groq (Llama 3.3) connected</Badge>
          ) : (
            <div className="space-y-1">
              <Badge tone="amber">Heuristic fallback mode</Badge>
              <p className="text-xs text-slate-500">
                Get a free key at console.groq.com (no card needed) and set GROQ_API_KEY in backend/.env for live AI output.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Profile snapshot */}
      {userId && (
        <Card title="Your skills">
          {skills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => <Badge key={s} tone="indigo">{s}</Badge>)}
            </div>
          ) : (
            <button onClick={() => navigate("profile")} className="text-sm text-indigo-600 hover:underline">
              Add your skills, or import them straight from your resume →
            </button>
          )}
        </Card>
      )}

      {/* Quick actions */}
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-600">Jump back in</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ACTIONS.map((a) => (
            <button
              key={a.type}
              onClick={() => (a.guest || userId ? navigate(a.type) : onRequestAuth())}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:border-indigo-200"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-lg text-indigo-600">{a.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                <p className="text-xs text-slate-500">{a.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
