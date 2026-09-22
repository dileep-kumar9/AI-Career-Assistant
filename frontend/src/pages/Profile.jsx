import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, Input, TextArea, ErrorBanner, Badge } from "../components/UI";

const FIELDS = [
  { key: "target_role", label: "Target role", type: "input" },
  { key: "location", label: "Location", type: "input" },
  { key: "work_preference", label: "Work preference (remote/hybrid/onsite)", type: "input" },
  { key: "skills", label: "Skills (comma separated)", type: "textarea" },
  { key: "experience", label: "Experience", type: "textarea" },
  { key: "education", label: "Education", type: "textarea" },
  { key: "projects", label: "Projects", type: "textarea" },
  { key: "certifications", label: "Certifications", type: "textarea" },
  { key: "achievements", label: "Achievements", type: "textarea" },
];

export default function Profile({ onRequestAuth }) {
  const { userId } = useUser();
  const [form, setForm] = useState({});
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);

  function load() {
    if (!userId) return;
    api.getProfile(userId).then((p) => { setForm(p); setExists(true); }).catch(() => setExists(false));
  }
  useEffect(load, [userId]);

  async function save(e) {
    e.preventDefault();
    setLoading(true); setError(""); setSaved(false);
    try {
      const result = await api.upsertProfile(userId, form, exists);
      setForm(result); setExists(true); setSaved(true);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function parseAndReview(text) {
    if (!text.trim()) throw new Error("Resume text is empty.");
    const parsed = await api.guestParsePreview(text);
    const fields = parsed.fields || {};
    setForm((current) => ({ ...current, ...fields }));
    setImportNote("Resume information extracted. Review and edit the fields below, then click Save profile.");
  }

  async function uploadAndExtract() {
    if (!userId) return onRequestAuth();
    if (!resumeFile) { setError("Choose a PDF, DOCX, or TXT resume first."); return; }
    setResumeBusy(true); setError(""); setImportNote("");
    try {
      const saved = await api.uploadResume(userId, "Master Resume", resumeFile);
      await parseAndReview(saved.content || "");
    } catch (err) { setError(err.message); }
    finally { setResumeBusy(false); }
  }

  async function importFromResume() {
    setImporting(true); setError(""); setImportNote("");
    try {
      const master = await api.getMasterResume(userId);
      await parseAndReview(master.content || "");
    } catch (err) {
      setError(err.message.includes("404") ? "No saved master resume found. Upload one below or paste its text." : err.message);
    } finally { setImporting(false); }
  }

  if (!userId) {
    return (
      <div className="max-w-md">
        <Card title="Sign in to manage your profile">
          <p className="mb-3 text-sm text-slate-500">Your profile powers resume tailoring, job matching, and career chat.</p>
          <Button onClick={onRequestAuth}>Sign in / create account</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Card title="Your profile">
        <section className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-800">Resume / Master Resume</h3>
          <p className="mt-1 text-sm text-slate-500">Upload a PDF, DOCX, or TXT file, or paste resume text. Extracted information will populate the form for your review.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} className="max-w-full text-sm" />
            <Button onClick={uploadAndExtract} loading={resumeBusy} disabled={!resumeFile}>Upload & extract</Button>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-600">Or paste resume text</label>
          <TextArea rows={5} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume here…" />
          <Button variant="secondary" className="mt-2" disabled={!resumeText.trim()} loading={resumeBusy} onClick={async () => { setResumeBusy(true); setError(""); try { await api.createResume(userId, { title: "Master Resume", content: resumeText, resume_type: "master" }); await parseAndReview(resumeText); } catch (e) { setError(e.message); } finally { setResumeBusy(false); } }}>Save master & extract</Button>
        </section>
        <div className="mb-4 flex items-center justify-between rounded-lg bg-indigo-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-indigo-900">Auto-detect from resume</p>
            <p className="text-xs text-indigo-700">Pulls skills, certifications, experience/internships, education, and projects from your saved master resume.</p>
          </div>
          <Button onClick={importFromResume} loading={importing}>Import from resume</Button>
        </div>
        {importNote && <p className="mb-3 text-sm text-emerald-600">{importNote}</p>}

        <form onSubmit={save} className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-sm font-medium text-slate-600">{f.label}</label>
              {f.type === "input" ? (
                <Input value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              ) : (
                <TextArea rows={3} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
          <ErrorBanner message={error} />
          {saved && <p className="text-sm text-emerald-600">Profile saved.</p>}
          <Button type="submit" loading={loading}>Save profile</Button>
        </form>
      </Card>
    </div>
  );
}
