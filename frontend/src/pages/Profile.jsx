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
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadNote, setUploadNote] = useState("");

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

  async function uploadMasterResume(file) {
    if (!file) return;
    setUploadingResume(true); setError(""); setUploadNote("");
    try {
      const saved = await api.uploadResume(userId, "Master Resume", file);
      setUploadNote(`Saved ${file.name} as your master resume.`);
    } catch (err) { setError(err.message || "Resume upload failed."); }
    finally { setUploadingResume(false); }
  }

  async function importFromResume() {
    setImporting(true); setError(""); setImportNote("");
    try {
      const result = await api.autoDetectProfile(userId, {});
      setForm(result); setExists(true);
      setImportNote("Fields below were auto-detected from your saved master resume — review and adjust as needed, then save.");
    } catch (err) {
      setError(err.message.includes("400") ? "No saved master resume found — upload one in Resume Maker first, then import here." : err.message);
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
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-800">Master resume</h3><p className="mt-1 text-xs text-slate-500">Upload a PDF, DOCX, or TXT file here. It becomes available in Resume Maker and profile import.</p></div>
            <label className={`inline-flex cursor-pointer items-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 ${uploadingResume ? "pointer-events-none opacity-60" : ""}`}>
              {uploadingResume ? "Uploading…" : "Choose resume"}
              <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="sr-only" disabled={uploadingResume} onChange={(e) => { const f=e.target.files?.[0]; e.target.value=""; if (f) uploadMasterResume(f); }} />
            </label>
          </div>
          {uploadNote && <p role="status" className="mt-2 text-sm text-emerald-700">{uploadNote}</p>}
        </div>
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
