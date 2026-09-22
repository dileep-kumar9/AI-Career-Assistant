import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, TextArea, Input, ErrorBanner, Badge } from "../components/UI";
import ResumePreview from "../components/ResumePreview";

function scoreColor(pct) {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-red-400";
}

function MatchMeter({ pct }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">ATS match score</span>
        <span className="font-bold text-slate-800">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${scoreColor(pct)} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export default function Resume({ params = {}, onRequestAuth }) {
  const { userId } = useUser();
  const [resumes, setResumes] = useState([]);
  const [hasMaster, setHasMaster] = useState(false);
  const [masterText, setMasterText] = useState("");
  const [title, setTitle] = useState(params.prefillTitle ? `Tailored: ${params.prefillTitle}` : "Master Resume");
  const [file, setFile] = useState(null);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [jd, setJd] = useState(params.prefillJD || "");
  const [analysis, setAnalysis] = useState(null);
  const [tailored, setTailored] = useState(null);
  const [detected, setDetected] = useState(null);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState("");
  const [promoted, setPromoted] = useState(false);
  const [previewMode, setPreviewMode] = useState("formatted");
  const [editedResume, setEditedResume] = useState("");

  // On open (and whenever the account changes), auto-load the saved master
  // resume -- this is THE resume from your uploaded PDF/DOCX, so you never
  // have to re-paste it. Only falls through to the empty paste box when
  // there's genuinely nothing saved yet.
  function loadMaster() {
    if (!userId) return;
    api.getMasterResume(userId).then((r) => { setMasterText(r.content); setHasMaster(true); })
      .catch(() => setHasMaster(false));
  }
  function refreshList() {
    if (userId) api.listResumes(userId).then(setResumes).catch(() => {});
  }
  useEffect(() => { loadMaster(); refreshList(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBusy = (key, v) => setLoading((l) => ({ ...l, [key]: v }));

  async function uploadFile() {
    if (!userId) return onRequestAuth();
    if (!file) return;
    setBusy("upload", true); setError("");
    try {
      const saved = await api.uploadResume(userId, title, file);
      setMasterText(saved.content);
      setHasMaster(true);
      setShowPasteBox(false);
      refreshList();
    } catch (e) { setError(e.message); } finally { setBusy("upload", false); }
  }

  async function saveMasterText() {
    if (!userId) return onRequestAuth();
    setBusy("save", true); setError("");
    try {
      await api.createResume(userId, { title, content: masterText, resume_type: "master" });
      setHasMaster(true);
      refreshList();
    } catch (e) { setError(e.message); } finally { setBusy("save", false); }
  }

  async function runAnalyze() {
    setBusy("analyze", true); setError("");
    try {
      setAnalysis(await api.analyzeResume({ resume: masterText, job_description: jd }));
    } catch (e) { setError(e.message); } finally { setBusy("analyze", false); }
  }

  async function runTailor(fmt) {
    if (!masterText.trim() || !jd.trim()) return;
    setBusy("tailor", true); setError(""); setPromoted(false);
    try {
      const result = userId
        ? await api.tailorResume(userId, { master_resume_text: masterText, job_description: jd, export_format: fmt || null })
        : await api.guestTailorResume({ master_resume_text: masterText, job_description: jd, export_format: fmt || null });
      setTailored(result);
      setEditedResume(result.resume_markdown || "");
    } catch (e) { setError(e.message); } finally { setBusy("tailor", false); }
  }

  async function exportCurrentResume(fmt) {
    if (!editedResume.trim()) return;
    setBusy(`export_${fmt}`, true); setError("");
    try {
      const result = userId
        ? await api.exportResume(userId, { resume_markdown: editedResume, export_format: fmt })
        : await api.guestExportResume({ resume_markdown: editedResume, export_format: fmt });
      setTailored((current) => ({ ...(current || {}), resume_markdown: editedResume, file_path: result.file_path }));
    } catch (e) { setError(e.message); } finally { setBusy(`export_${fmt}`, false); }
  }

  async function saveTailoredToAccount() {
    if (!userId) return onRequestAuth();
    if (!editedResume.trim()) return;
    setBusy("saveTailored", true); setError("");
    try {
      await api.createResume(userId, { title, content: editedResume, resume_type: "tailored" });
      refreshList();
    } catch (e) { setError(e.message); } finally { setBusy("saveTailored", false); }
  }

  async function promoteTailoredToMaster() {
    if (!userId) return onRequestAuth();
    if (!editedResume.trim()) return;
    setBusy("promote", true); setError("");
    try {
      await api.setMasterResume(userId, { content: editedResume, title });
      setMasterText(editedResume);
      setHasMaster(true);
      setPromoted(true);
      refreshList();
    } catch (e) { setError(e.message); } finally { setBusy("promote", false); }
  }

  async function runAutoDetect() {
    if (!userId) return onRequestAuth();
    if (!masterText.trim()) return;
    setBusy("detect", true); setError("");
    try {
      setDetected(await api.autoDetectProfile(userId, { resume_text: masterText }));
    } catch (e) { setError(e.message); } finally { setBusy("detect", false); }
  }

  const downloadUrl = tailored?.file_path
    ? (userId ? api.resumeDownloadUrl(userId, tailored.file_path) : api.guestDownloadUrl(tailored.file_path))
    : null;

  return (
    <div className="space-y-4">
      {!userId && (
        <div className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          You're using Resume Maker as a guest — tailoring and export work fully, but nothing is saved.{" "}
          <button onClick={onRequestAuth} className="font-medium underline">Sign in</button> to save your master resume so you never have to upload it twice.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Your master resume">
          <div className="space-y-3">
            {userId && hasMaster ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <span>Using your saved master resume — no need to re-upload.</span>
                <button onClick={() => setShowPasteBox((s) => !s)} className="font-medium underline">
                  {showPasteBox ? "Hide" : "Edit"}
                </button>
              </div>
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {userId ? "No master resume saved yet — upload a PDF/DOCX or paste text below." : "Upload a PDF/DOCX or paste text below."}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files[0])} className="text-sm" />
              <Button onClick={uploadFile} loading={loading.upload} disabled={!file}>
                {userId ? "Upload & use as master" : "Sign in to upload"}
              </Button>
              {!showPasteBox && (!hasMaster || !userId) && (
                <button onClick={() => setShowPasteBox(true)} className="text-sm text-indigo-600 hover:underline">
                  or paste text instead
                </button>
              )}
            </div>

            {(showPasteBox || !userId) && (
              <>
                <Input placeholder="Resume title" value={title} onChange={(e) => setTitle(e.target.value)} />
                <TextArea rows={10} placeholder="Paste your resume text here…"
                  value={masterText} onChange={(e) => setMasterText(e.target.value)} />
                {userId && (
                  <Button onClick={saveMasterText} loading={loading.save} disabled={!masterText.trim()}>
                    Save as master
                  </Button>
                )}
              </>
            )}

            {userId && (
              <Button variant="secondary" onClick={runAutoDetect} loading={loading.detect} disabled={!masterText.trim()}>
                Auto-detect profile from this resume
              </Button>
            )}
            {detected && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                Profile updated: skills, certifications, experience, education, and projects were auto-filled from this resume.
              </div>
            )}
            {userId && resumes.filter((r) => r.resume_type !== "master").length > 0 && (
              <div className="pt-2">
                <p className="mb-1 text-xs font-medium text-slate-500">Saved tailored versions</p>
                <ul className="space-y-1 text-sm">
                  {resumes.filter((r) => r.resume_type !== "master").map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5">
                      <button className="truncate text-left hover:text-indigo-600" onClick={() => setMasterText(r.content)}>{r.title}</button>
                      <Badge tone="slate">{r.resume_type}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <Card title="2. Target job description">
          <TextArea rows={10} placeholder="Paste the job description you're targeting…" value={jd} onChange={(e) => setJd(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={runAnalyze} loading={loading.analyze} disabled={!masterText.trim() || !jd.trim()}>
              Analyze match (ATS-style)
            </Button>
            <Button onClick={() => runTailor()} loading={loading.tailor} disabled={!masterText.trim() || !jd.trim()}>
              Tailor resume with AI
            </Button>
          </div>
          <ErrorBanner message={error} />

          {analysis && (
            <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4">
              <MatchMeter pct={analysis.match_score_percent} />
              <p className="text-sm text-slate-600"><span className="font-medium text-emerald-700">Matched ({analysis.matched_count}):</span> {analysis.matched_terms.slice(0, 20).join(", ") || "—"}</p>
              <p className="text-sm text-slate-600"><span className="font-medium text-red-600">Missing ({analysis.missing_count}):</span> {analysis.missing_terms.slice(0, 20).join(", ") || "—"}</p>
              <p className="text-xs italic text-slate-400">{analysis.note}</p>
            </div>
          )}

        </Card>
      </div>

      {tailored && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={tailored.provider === "groq" ? "green" : "amber"}>
              {tailored.provider === "groq" ? "AI-tailored" : "Heuristic fallback"}
            </Badge>
            <span className="text-sm text-slate-500">Edit on the left; the formatted resume updates live on the right.</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => exportCurrentResume("docx")} loading={loading.export_docx}>Export .docx</Button>
              <Button variant="secondary" onClick={() => exportCurrentResume("pdf")} loading={loading.export_pdf}>Export .pdf</Button>
              {downloadUrl && <a className="self-center text-sm text-indigo-600 underline" href={downloadUrl} target="_blank" rel="noreferrer">Download latest export</a>}
              <button onClick={() => navigator.clipboard?.writeText(editedResume)} className="self-center text-sm text-slate-500 hover:text-indigo-600">Copy text</button>
            </div>
          </div>
          {userId && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={saveTailoredToAccount} loading={loading.saveTailored}>Save as a separate version</Button>
              <Button onClick={promoteTailoredToMaster} loading={loading.promote}>Update my master resume with this</Button>
              {promoted && <span className="text-sm text-emerald-600">Master resume updated ✓</span>}
            </div>
          )}
          <div className="resume-editor-split">
            <section className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Edit resume</h3>
                <span className="text-xs text-slate-400">Markdown / plain text</span>
              </div>
              <textarea value={editedResume} onChange={(e) => { setEditedResume(e.target.value); setTailored((current) => ({ ...(current || {}), resume_markdown: e.target.value, file_path: null })); }} className="resume-editor" aria-label="Edit generated resume" spellCheck="false" />
            </section>
            <section className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Live preview</h3>
                <div className="flex overflow-hidden rounded-md ring-1 ring-slate-200">
                  <button onClick={() => setPreviewMode("formatted")} className={`px-3 py-1 text-xs font-medium ${previewMode === "formatted" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Formatted</button>
                  <button onClick={() => setPreviewMode("plain")} className={`px-3 py-1 text-xs font-medium ${previewMode === "plain" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Plain text</button>
                </div>
              </div>
              <div className="resume-preview-wrap resume-preview-full">
                {previewMode === "formatted" ? <ResumePreview content={editedResume} name={title} /> : <pre className="whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{editedResume}</pre>}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
