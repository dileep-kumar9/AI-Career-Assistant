import { useEffect, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { api } from "../api/client";
import { Card, Button, TextArea, Input, ErrorBanner, Badge } from "../components/UI";

const TYPES = ["HR", "Technical", "Behavioral", "JD-Specific"];

// Browser-native speech-to-text (Web Speech API). Real and functional in
// Chrome/Edge; gracefully disabled elsewhere. No server-side STT needed.
function useSpeechRecognition(onResult) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const supported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function start() {
    if (!supported) return;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => onResult(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }
  function stop() {
    recRef.current?.stop();
    setListening(false);
  }
  return { supported, listening, start, stop };
}

export default function Interview({ onRequestAuth }) {
  const { userId } = useUser();
  const [type, setType] = useState("HR");
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState([]);
  const [provider, setProvider] = useState(null);
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState("typing");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState("");

  const speech = useSpeechRecognition((text) => setAnswer((a) => (a ? a + " " : "") + text));

  const setBusy = (k, v) => setLoading((l) => ({ ...l, [k]: v }));

  function loadHistory() {
    api.interviewHistory(userId).then(setHistory).catch(() => {});
  }
  useEffect(() => { if (userId) loadHistory(); }, [userId]);

  function speak(text) {
    if (mode === "auto_voice" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }

  async function getQuestions() {
    setBusy("q", true); setError(""); setResult(null); setCurrent(0);
    try {
      const r = await api.interviewQuestions(type, jd, 5);
      setQuestions(r.questions);
      setProvider(r.provider);
      if (r.questions[0]) speak(r.questions[0]);
    } catch (e) { setError(e.message); } finally { setBusy("q", false); }
  }

  async function submit() {
    if (!questions[current] || !answer.trim()) {
      setError("Start an interview and enter an answer before submitting.");
      return;
    }
    setBusy("submit", true); setError("");
    try {
      if (userId) {
        const r = await api.submitInterviewAnswer({
          user_id: userId, interview_type: type, mode,
          question: questions[current], answer, expected_topics: [],
        });
        setResult(r);
        loadHistory();
      } else {
        const r = await api.evaluateAnswerPreview(questions[current], answer, []);
        setResult(r);
      }
    } catch (e) { setError(e.message); } finally { setBusy("submit", false); }
  }

  function next() {
    const nextIdx = current + 1;
    setCurrent(nextIdx);
    setAnswer("");
    setResult(null);
    if (questions[nextIdx]) speak(questions[nextIdx]);
  }

  return (
    <div className="space-y-4">
      {!userId && (
        <div className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          Practicing as a guest — answers are evaluated but not saved.{" "}
          <button onClick={onRequestAuth} className="font-medium underline">Sign in</button> to keep interview history.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Setup" className="lg:col-span-1">
        <div className="space-y-3">
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          {type === "JD-Specific" && (
            <TextArea rows={5} placeholder="Paste the job description…" value={jd} onChange={(e) => setJd(e.target.value)} />
          )}
          <div className="flex gap-2 text-sm">
            {["typing", "manual_voice", "auto_voice"].map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m.replace("_", " ")}
              </label>
            ))}
          </div>
          {!speech.supported && mode !== "typing" && (
            <p className="text-xs text-amber-600">Voice input isn't supported in this browser — try Chrome/Edge, or use typing mode.</p>
          )}
          <Button onClick={getQuestions} loading={loading.q} className="w-full">Start interview</Button>
          {provider && <Badge tone={provider === "groq" ? "green" : "amber"}>{provider === "groq" ? "AI-generated questions" : "Question bank fallback"}</Badge>}
        </div>
      </Card>

      <Card title={questions.length ? `Question ${current + 1} of ${questions.length}` : "Questions"} className="lg:col-span-2">
        {questions[current] ? (
          <div className="space-y-3">
            <p className="text-lg font-medium text-slate-800">{questions[current]}</p>
            <TextArea rows={5} placeholder="Type your answer, or use voice input…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            {mode !== "typing" && speech.supported && (
              <Button variant="secondary" onClick={speech.listening ? speech.stop : speech.start}>
                {speech.listening ? "Stop recording" : "Record answer"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button onClick={submit} loading={loading.submit} disabled={!answer.trim()}>Submit answer</Button>
              {result && current < questions.length - 1 && <Button variant="secondary" onClick={next}>Next question</Button>}
            </div>
            <ErrorBanner message={error} />
            {result && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={result.feedback ? "indigo" : "slate"}>{userId ? "Feedback saved" : "Answer evaluated (not saved)"}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-slate-700">{result.feedback}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Choose a type and click "Start interview".</p>
        )}
      </Card>

      {history.length > 0 && (
        <Card title="Interview history" className="lg:col-span-3">
          <ul className="space-y-2 text-sm">
            {history.slice(0, 10).map((h) => (
              <li key={h.id} className="rounded-md bg-slate-50 p-3">
                <p className="font-medium">{h.question}</p>
                <p className="mt-1 text-slate-500">{h.feedback}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      </div>
    </div>
  );
}
