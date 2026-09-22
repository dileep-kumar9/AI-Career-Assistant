import React from "react";

// Convert the generator's Markdown-like output into a clean, printable resume layout.
export default function ResumePreview({ content = "", name = "Resume preview" }) {
  const clean = content.replace(/^# Resume \(heuristic fallback[^\n]*\)\n*/i, "").replace(/^## Original Content\n*/i, "").trim();
  const lines = clean.split(/\r?\n/);
  const blocks = []; let list = [];
  const flush = () => { if (list.length) { blocks.push(<ul className="resume-bullets" key={`list-${blocks.length}`}>{list.map((x,i)=><li key={i}>{x.replace(/^[-*•]\s*/, "")}</li>)}</ul>); list=[]; } };
  lines.forEach((raw, idx) => { const line=raw.trim(); if (!line) { flush(); return; }
    if (/^[-*•]\s+/.test(line)) { list.push(line); return; } flush();
    if (/^#{1,3}\s/.test(line)) { blocks.push(<h3 key={idx}>{line.replace(/^#{1,3}\s*/, "")}</h3>); return; }
    if (/^[A-Z][A-Z &/|()—-]{2,}$/.test(line) && line.length < 55) { blocks.push(<h3 key={idx}>{line}</h3>); return; }
    if (idx===0 || (/^[A-Z][A-Z .'-]+$/.test(line) && line.length < 45)) { blocks.push(<h1 key={idx}>{line}</h1>); return; }
    blocks.push(<p key={idx}>{line.replace(/\*\*(.*?)\*\*/g,"$1")}</p>);
  }); flush();
  return <article className="resume-paper" aria-label={name}>{blocks}</article>;
}
