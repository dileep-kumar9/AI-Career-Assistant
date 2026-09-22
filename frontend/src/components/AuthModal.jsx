import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import Modal from "./Modal";
import { Button, Input, ErrorBanner } from "./UI";

export default function AuthModal({ open, onClose }) {
  const { createAndSetUser, signInWithGoogleCredential } = useUser();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const render = () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const target = document.getElementById("google-signin-button");
      if (!target || !clientId || !window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          setLoading(true); setError("");
          try { await signInWithGoogleCredential(credential); onClose(); }
          catch (err) { setError(err.message || "Google sign-in failed."); }
          finally { setLoading(false); }
        },
      });
      target.innerHTML = "";
      window.google.accounts.id.renderButton(target, { theme: "outline", size: "large", shape: "rectangular", text: "continue_with", width: 320 });
      return true;
    };
    let attempts = 0;
    const timer = setInterval(() => { attempts += 1; if (render() || attempts > 30 || cancelled) clearInterval(timer); }, 250);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await createAndSetUser(form);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Sign in / create account">
      <p className="mb-3 text-sm text-slate-500">
        This creates (or reuses) your account so your profile, resumes, and applications can be saved.
        You can keep using Resume Maker, Job Discovery, and Interview without this.
      </p>
      <div className="mb-4">
        <div id="google-signin-button" className="flex min-h-10 justify-center" />
        {!import.meta.env.VITE_GOOGLE_CLIENT_ID && <p className="mt-2 text-center text-xs text-amber-700">Google sign-in needs VITE_GOOGLE_CLIENT_ID in frontend/.env and GOOGLE_CLIENT_ID in backend/.env.</p>}
      </div>
      <div className="mb-3 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or use email<span className="h-px flex-1 bg-slate-200" /></div>
      <form onSubmit={submit} className="space-y-3">
        <Input placeholder="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <ErrorBanner message={error} />
        <Button type="submit" loading={loading} className="w-full">Continue</Button>
      </form>
    </Modal>
  );
}
