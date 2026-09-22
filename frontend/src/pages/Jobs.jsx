import { useState } from "react";
import { useUser } from "../context/UserContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Card, Button, Input, TextArea, ErrorBanner, Badge } from "../components/UI";

function scoreTone(pct) {
  if (pct >= 60) return "green";
  if (pct >= 30) return "amber";
  return "slate";
}

export default function Jobs() {
  const { userId } = useUser();
  const { navigate } = useWorkspace();
  const [query, setQuery] = useState("");
  const [rankByProfile, setRankByProfile] = useState(!!userId);
  const [manualProfile, setManualProfile] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setLoading(true); setError("");
    try {
      const results = rankByProfile
        ? await api.discoverRanked(query, 25, userId ? { userId } : { profileText: manualProfile })
        : await api.discoverJobs(query, 25);
      setJobs(results);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function logApplication(job) {
    try {
      await api.createApplication(userId, { job_id: job.id || null, company: job.company, job_title: job.title, job_url: job.url });
    } catch (e) { setError(e.message); }
  }

  function tailorResumeFor(job) {
    navigate("resume", { prefillJD: job.description || "", prefillTitle: job.title });
  }

  function autoApplyTo(job) {
    navigate("autoapply", { prefillUrl: job.url || "", prefillCompany: job.company, prefillTitle: job.title });
  }

  return (
    <div className="space-y-4">
      <Card title="Auto search &amp; apply">
        <p className="mb-3 text-sm text-slate-500">
          Live results from open, no-auth job board APIs (Arbeitnow + RemoteOK) — not scraped from sites that forbid it.
          Turn on ranking to sort results by how well they match your resume, then tailor or auto-apply straight from a card.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="e.g. backend engineer, react, data analyst" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={search} loading={loading}>Search</Button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={rankByProfile} onChange={(e) => setRankByProfile(e.target.checked)} />
          Rank by match to my {userId ? "saved resume" : "resume (paste below)"}
        </label>
        {rankByProfile && !userId && (
          <TextArea className="mt-2" rows={3} placeholder="Paste your resume/skills to rank matches against…"
            value={manualProfile} onChange={(e) => setManualProfile(e.target.value)} />
        )}
        <ErrorBanner message={error} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {jobs.map((job) => (
          <Card key={`${job.source}-${job.external_id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-800">{job.title}</h3>
                <p className="text-sm text-slate-500">{job.company} · {job.location || "—"}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone="slate">{job.source}</Badge>
                {typeof job.match_percentage === "number" && (
                  <Badge tone={scoreTone(job.match_percentage)}>{job.match_percentage}% match</Badge>
                )}
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: (job.description || "").slice(0, 220) }} />
            <div className="mt-3 flex flex-wrap gap-3">
              {job.url && <a className="text-sm text-indigo-600 underline" href={job.url} target="_blank" rel="noreferrer">View posting</a>}
              <button className="text-sm text-slate-500 hover:text-indigo-600" onClick={() => logApplication(job)}>+ Track this job</button>
              <button className="text-sm text-emerald-600 hover:underline" onClick={() => tailorResumeFor(job)}>✎ Tailor resume</button>
              {job.url && <button className="text-sm text-amber-600 hover:underline" onClick={() => autoApplyTo(job)}>▶ Auto-apply</button>}
            </div>
          </Card>
        ))}
        {!loading && jobs.length === 0 && <p className="text-sm text-slate-400">No results yet — try a search above.</p>}
      </div>
    </div>
  );
}
