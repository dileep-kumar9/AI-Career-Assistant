import React from "react";

const inlineFormat = (value) => value.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
  part.startsWith("**") && part.endsWith("**")
    ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part
);

// Structured, printable document preview for the generator's Markdown/plain-text output.
export default function ResumePreview({ content = "", name = "Resume preview" }) {
  const cleaned = content
    .replace(/^# Resume \(heuristic fallback[^\n]*\)\n*/i, "")
    .replace(/^## Original Content\n*/i, "")
    .replace(/\(cid:127\)|\u0007/g, "•")
    .trim();
  const lines = cleaned.split(/\r?\n/);
  const blocks = [];
  let bullets = [];
  let firstText = true;
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(<ul className="resume-bullets" key={`bullets-${blocks.length}`}>
      {bullets.map((item, index) => <li key={index}>{inlineFormat(item.replace(/^[-*•]\s*/, ""))}</li>)}
    </ul>);
    bullets = [];
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (/^(?:[-*•]|\(cid:127\))\s*/.test(line)) { bullets.push(line); return; }
    flush();

    if (firstText && !/^#{1,3}\s/.test(line)) {
      blocks.push(<h1 key={`name-${index}`}>{line.replace(/^#\s*/, "")}</h1>);
      firstText = false;
      return;
    }
    firstText = false;

    if (/^#{1,3}\s/.test(line)) {
      blocks.push(<h3 key={index}>{line.replace(/^#{1,3}\s*/, "")}</h3>);
      return;
    }
    if (/^[A-Z][A-Z &/|()—–-]{2,}$/.test(line) && line.length < 65) {
      blocks.push(<h3 key={index}>{line}</h3>);
      return;
    }
    // Contact information commonly arrives pipe-delimited; render it as one compact line.
    if (/(?:@|\+?\d[\d ()-]{6,}|linkedin|github|https?:\/\/)/i.test(line) && line.length < 220) {
      blocks.push(<p className="resume-contact" key={index}>{inlineFormat(line.replace(/\s*\|\s*/g, "  ·  "))}</p>);
      return;
    }
    blocks.push(<p key={index}>{inlineFormat(line.replace(/\s*\|\s*/g, " · "))}</p>);
  });
  flush();
  return <article className="resume-paper" aria-label={name}>{blocks}</article>;
}
