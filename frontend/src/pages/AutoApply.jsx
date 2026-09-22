import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, Input, ErrorBanner, Badge } from "../components/UI";

const FIELD_KEYS = ["name", "email", "phone", "location", "linkedin", "portfolio"];

export default function AutoApply({ params = {} }) {
  const { userId } = useUser();
  const [url, setUrl] = useState(params.prefillUrl || "");
  const [manual, setManual] = useState({});
  const [headless, setHeadless] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    if (userId) {
      api.getUser(userId).then((u) => setManual((m) => ({ ...m, name: u.name, email: u.email, phone: u.phone || "" }))).catch(() => {});
      api.getProfile(userId).then((p) => setManual((m) => ({ ...m, location: p.location || "" }))).catch(() => {});
    }
  }, [userId]);

  async function run() {
    if (!url.trim()) return;
    setLoading(true); setError(""); setResult(null); setTracked(false);
    try {
      const r = userId
        ? await api.autofillWithAccount({ url, user_id: userId, profile_overrides: manual, headless })
        : await api.guestAutofill({ url, profile: manual, headless });
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function addToTracker() {
    if (!userId) return;
    try {
      await api.createApplication(userId, {
        company: params.prefillCompany || new URL(url).hostname.replace("www.", ""),
        job_title: params.prefillTitle || "Untitled role",
        job_url: url,
        status: "Applied",
      });
      setTracked(true);
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card title="Auto-apply assistant">
        <p className="text-sm text-slate-500">
          Opens the application page and fills in fields it can confidently map from your details below
          — including attaching your uploaded resume file to a file-upload field, if you've uploaded one
          under Resume Maker (pasted-text-only resumes can't be auto-attached, since there's no original
          file). It will <b>never</b> submit the application and will <b>never</b> attempt to bypass a
          CAPTCHA — it pauses and hands control back to you for review every time. This requires
          Playwright's browser to be installed locally (<code className="rounded bg-slate-100 px-1">playwright install chromium</code>)
          and only works when you run the backend on your own machine (not headless-only hosting).
        </p>

        <div className="mt-4 space-y-3">
          <Input placeholder="Job application page URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELD_KEYS.map((k) => (
              <Input key={k} placeholder={k} value={manual[k] || ""} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
            Run headless (no visible browser window — you won't be able to review before closing)
          </label>
          {!headless && (
            <p className="text-xs text-amber-600">Recommended: leave headless off so the browser stays open for you to check and submit yourself.</p>
          )}
          <Button onClick={run} loading={loading} disabled={!url.trim()}>Fill this application</Button>
        </div>

        <ErrorBanner message={error} />

        {result && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <Badge tone={result.status?.startsWith("paused") ? "green" : result.status === "error" ? "amber" : "slate"}>
              {result.status}
            </Badge>
            {result.message && <p className="mt-2 text-slate-700">{result.message}</p>}
            {result.filled_fields && (
              <p className="mt-2 text-slate-600">Filled: {result.filled_fields.join(", ") || "none"}</p>
            )}
            {result.skipped_fields?.length > 0 && (
              <p className="mt-1 text-slate-600">Skipped: {result.skipped_fields.join(", ")}</p>
            )}
            {result.final_submission && <p className="mt-2 text-xs italic text-slate-400">{result.final_submission}</p>}
            {result.status?.startsWith("paused") && userId && !tracked && (
              <Button className="mt-3" variant="secondary" onClick={addToTracker}>+ Add to tracker as "Applied"</Button>
            )}
            {tracked && <p className="mt-2 text-sm text-emerald-600">Added to your tracker.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
