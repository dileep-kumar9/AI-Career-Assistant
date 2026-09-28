import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser speech helpers for the live interview:
 *  - speak(): the interviewer's voice (Web Speech synthesis, works offline in most browsers);
 *  - useRecognizer(): speech-to-text for the candidate (Chrome / Edge; audio is processed by the
 *    browser vendor's speech service);
 *  - useMicLevel(): microphone loudness, to tell "speaking" from "silent" independently of the
 *    recogniser (which can lag or stop on its own).
 */

// ------------------------------------------------------------------ text to speech

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en(-|_)/i.test(v.lang));
  return en.find((v) => /natural|neural|google us|aria|jenny|guy/i.test(v.name)) || en.find((v) => /en-(US|GB|IN)/i.test(v.lang)) || en[0] || voices[0] || null;
}

/** Speaks text and resolves when finished (or immediately when speech is unavailable or cancelled). */
export function speak(text: string, rate = 1): Promise<void> {
  if (!ttsSupported || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
    // Some browsers never fire onend for long text: resolve after a generous estimate.
    setTimeout(resolve, Math.max(4000, text.split(/\s+/).length * 550));
  });
}

export const stopSpeaking = () => ttsSupported && window.speechSynthesis.cancel();

// ------------------------------------------------------------------ speech to text

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognizerCtor = new () => Recognizer;

const Ctor: RecognizerCtor | null =
  typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: RecognizerCtor }).webkitSpeechRecognition || null) : null;

export const sttSupported = !!Ctor;

/**
 * Continuous recognition that restarts itself while `active` (Chrome ends a
 * session after a pause). `onText` receives final text; `onActivity` fires on
 * any recognised speech (interim or final).
 */
export function useRecognizer(opts: { onText: (t: string) => void; onInterim: (t: string) => void; onActivity: () => void; onError: (msg: string) => void }) {
  const rec = useRef<Recognizer | null>(null);
  const wanted = useRef(false);
  const cb = useRef(opts);
  cb.current = opts;
  const [listening, setListening] = useState(false);

  const start = useCallback(() => {
    if (!Ctor) return;
    wanted.current = true;
    if (rec.current) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current.onText(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      cb.current.onInterim(interim.trim());
      cb.current.onActivity();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted.current = false;
        cb.current.onError('Microphone access was blocked. Allow the microphone for this site, or answer by typing.');
      } else if (e.error === 'network') cb.current.onError('Speech recognition needs an internet connection. You can answer by typing.');
    };
    r.onend = () => {
      rec.current = null;
      if (wanted.current) setTimeout(() => wanted.current && start(), 150);
      else setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    rec.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => {
    wanted.current = false;
    rec.current?.abort();
  }, []);

  return { start, stop, listening, supported: sttSupported };
}

// ------------------------------------------------------------------ microphone level

/** 0..1 loudness of the microphone, sampled ~10×/s while enabled. */
export function useMicLevel(enabled: boolean) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: number | undefined;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 8));
        }, 100);
      })
      .catch(() => setError('Microphone access was blocked. Allow it in the browser, or answer by typing.'));
    return () => {
      alive = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => undefined);
      setLevel(0);
    };
  }, [enabled]);
  return { level, error };
}
