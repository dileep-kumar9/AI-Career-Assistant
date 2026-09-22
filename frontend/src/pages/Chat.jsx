import { useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, Input, ErrorBanner, Badge } from "../components/UI";

export default function Chat({ onRequestAuth }) {
  const { userId } = useUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function send(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true); setError("");
    try {
      const r = await api.chat({ user_id: userId, message: userMsg.text });
      setMessages((m) => [...m, { role: "assistant", text: r.answer, provider: r.provider, context: r.context }]);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card title="Career chat">
        <p className="mb-3 text-sm text-slate-500">
          {userId ? "Answers can use relevant details from your saved profile and resumes." : "Guest chat is available. Sign in to get answers grounded in your saved profile and resumes and keep your account history."}
          {!userId && <> <button onClick={onRequestAuth} className="font-medium underline">Sign in</button></>}
        </p>
        <div className="mb-3 max-h-[28rem] space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={`rounded-lg p-3 text-sm ${m.role === "user" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>
              {m.role === "assistant" && m.provider && (
                <Badge tone={m.provider === "groq" ? "green" : "amber"}>{m.provider === "groq" ? "AI" : "fallback"}</Badge>
              )}
              <p className="mt-1 whitespace-pre-wrap">{m.text}</p>
            </div>
          ))}
          {messages.length === 0 && <p className="text-sm text-slate-400">Ask about your resume, target role, or how to prep for an interview.</p>}
        </div>
        <ErrorBanner message={error} />
        <form onSubmit={send} className="flex gap-2">
          <Input placeholder="Ask something…" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" loading={loading} disabled={!input.trim() || loading}>Send</Button>
        </form>
      </Card>
    </div>
  );
}
