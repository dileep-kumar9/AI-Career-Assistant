import { useState } from "react";
import { useUser } from "../context/UserContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../api/client";
import { Card, Button, Input, TextArea, ErrorBanner, Badge } from "../components/UI";

export default function JobLink() {
  const { userId } = useUser();
  const { navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [parsed, setParsed] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState("");

  const setBusy = (k, v) => setLoading((l) => ({ ...l, [k]: v }));

  async function fetchJob() {
    setBusy("fetch", true); setError("");
    try {
      const result = await api.parseJobLink(url);
      if (result.status === "error") setError(result.message);
      setParsed(result);
    } catch (e) { setError(e.message); } finally { setBusy("fetch", false); }
  }

  async function checkMatch() {
    setBusy("match", true); setError("");
    try {
      setMatch(await api.matchJob({ profile: resumeText, job_description: parsed.description }));
    } catch (e) { setError(e.message); } finally { setBusy("match", false); }
  }

  const [company, setCompany] = useState("");

  async function track() {
    try {
      await api.createApplication(userId, { company: company || new URL(url).hostname.replace("www.", ""), job_title: parsed.title || "Untitled role", job_url: url });
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card title="Paste a job posting URL">
        <div className="flex gap-2">
          <Input placeholder="https://…/job-posting" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button onClick={fetchJob} loading={loading.fetch} disabled={!url.trim()}>Fetch</Button>
        </div>
        <ErrorBanner message={error} />
      </Card>

      {parsed && parsed.status !== "error" && (
        <Card title={parsed.title || "Job description"}>
          <Badge tone={parsed.status === "parsed" ? "green" : "amber"}>{parsed.status}</Badge>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {parsed.description}
          </pre>

          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium text-slate-600">Company (for tracking)</label>
            <Input placeholder="e.g. Acme Corp" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-600">Your resume/profile text (to check match)</label>
            <TextArea rows={5} value={resumeText} onChange={(e) => setResumeText(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={checkMatch} loading={loading.match} disabled={!resumeText.trim()}>Check match</Button>
              <Button onClick={track}>+ Track this application</Button>
              <Button variant="secondary" onClick={() => navigate("resume", { prefillJD: parsed.description, prefillTitle: parsed.title })}>
                ✎ Create tailored resume
              </Button>
              <Button variant="secondary" onClick={() => navigate("autoapply", { prefillUrl: url, prefillCompany: company, prefillTitle: parsed.title })}>▶ Auto-apply</Button>
            </div>
          </div>

          {match && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Match: {match.match_percentage}%</p>
              <p className="text-slate-600">Missing terms: {match.missing_terms.slice(0, 15).join(", ") || "—"}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
