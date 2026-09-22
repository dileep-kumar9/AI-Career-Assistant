"""Real text extraction for .txt, .pdf, and .docx files, plus resume export
to .docx and .pdf. All three libraries are pure-Python / no external
service calls, so this works fully offline once installed via requirements.txt.
"""
from pathlib import Path
import io


def extract_text(path: str) -> str:
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".txt":
        return p.read_text(encoding="utf-8", errors="ignore")
    if suffix == ".pdf":
        return _extract_pdf(p)
    if suffix == ".docx":
        return _extract_docx(p)
    return ""


def extract_text_from_bytes(data: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".txt":
        return data.decode("utf-8", errors="ignore")
    if suffix == ".pdf":
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)
    if suffix == ".docx":
        import docx
        doc = docx.Document(io.BytesIO(data))
        return "\n".join(par.text for par in doc.paragraphs)
    return ""


def _extract_pdf(path: Path) -> str:
    import pdfplumber
    with pdfplumber.open(str(path)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def _extract_docx(path: Path) -> str:
    import docx
    doc = docx.Document(str(path))
    return "\n".join(par.text for par in doc.paragraphs)


def render_resume_docx(markdown_text: str, out_path: str) -> str:
    """Very simple Markdown -> .docx renderer good enough for resume structure
    (headings starting with '#', bullet lines starting with '-')."""
    import docx
    doc = docx.Document()
    for line in markdown_text.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        if line.startswith("### "):
            doc.add_heading(line[4:].strip(), level=3)
        elif line.startswith("## "):
            doc.add_heading(line[3:].strip(), level=2)
        elif line.startswith("# "):
            doc.add_heading(line[2:].strip(), level=1)
        elif line.strip().startswith(("- ", "* ")):
            doc.add_paragraph(line.strip()[2:].strip(), style="List Bullet")
        else:
            doc.add_paragraph(line.strip())
    doc.save(out_path)
    return out_path


def render_resume_pdf(markdown_text: str, out_path: str) -> str:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem
    from reportlab.lib.styles import getSampleStyleSheet

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(out_path, pagesize=LETTER)
    story = []
    bullets = []

    def flush_bullets():
        nonlocal bullets
        if bullets:
            story.append(ListFlowable([ListItem(Paragraph(b, styles["Normal"])) for b in bullets], bulletType="bullet"))
            bullets = []

    for line in markdown_text.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        if line.startswith(("# ", "## ", "### ")):
            flush_bullets()
            level = line.count("#", 0, 3)
            text = line.lstrip("#").strip()
            style = styles["Heading1"] if level == 1 else styles["Heading2"]
            story.append(Spacer(1, 10))
            story.append(Paragraph(text, style))
        elif line.strip().startswith(("- ", "* ")):
            bullets.append(line.strip()[2:].strip())
        else:
            flush_bullets()
            story.append(Paragraph(line.strip(), styles["Normal"]))
    flush_bullets()
    doc.build(story)
    return out_path
