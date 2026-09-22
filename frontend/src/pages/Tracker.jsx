import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, Input, ErrorBanner, Badge } from "../components/UI";

const STATUSES = ["New", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"];
const TONE = { New: "slate", Applied: "indigo", Interviewing: "amber", Offer: "green", Rejected: "slate", Withdrawn: "slate" };

export default function Tracker({ onRequestAuth }) {
  const { userId } = useUser();
  const [apps, setApps] = useState([]);
  const [form, setForm] = useState({ company: "", job_title: "", job_url: "" });
  const [error, setError] = useState("");

  function refresh() {
    api.listApplications(userId).then(setApps).catch((e) => setError(e.message));
  }
  useEffect(() => { if (userId) refresh(); }, [userId]);

  async function add(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createApplication(userId, form);
      setForm({ company: "", job_title: "", job_url: "" });
      refresh();
    } catch (e2) { setError(e2.message); }
  }

  async function setStatus(appId, status) {
    await api.updateApplicationStatus(userId, appId, status);
    refresh();
  }

  async function remove(appId) {
    await api.deleteApplication(userId, appId);
    refresh();
  }

  if (!userId) {
    return (
      <div className="max-w-md">
        <Card title="Sign in to track applications">
          <p className="mb-3 text-sm text-slate-500">Log applications, update statuses, and see a summary once you're signed in.</p>
          <Button onClick={onRequestAuth}>Sign in / create account</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="Log a new application">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="Company" required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <Input placeholder="Job title" required value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
          <Input placeholder="Job URL (optional)" value={form.job_url} onChange={(e) => setForm({ ...form, job_url: e.target.value })} />
          <Button type="submit" className="sm:col-span-3 w-fit">Add</Button>
        </form>
        <ErrorBanner message={error} />
      </Card>

      <div className="space-y-2">
        {apps.map((a) => (
          <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-800">{a.job_title}</p>
              <p className="text-sm text-slate-500">{a.company} · applied {new Date(a.application_date).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Badge tone={TONE[a.status] || "slate"}>{a.status}</Badge>
              <button className="text-sm text-red-500 hover:underline" onClick={() => remove(a.id)}>Remove</button>
            </div>
          </Card>
        ))}
        {apps.length === 0 && <p className="text-sm text-slate-400">No applications logged yet.</p>}
      </div>
    </div>
  );
}
