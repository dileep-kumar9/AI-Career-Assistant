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
    """Render readable Markdown-style resume text into a compact PDF."""
    from xml.sax.saxutils import escape
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, KeepTogether

    base = getSampleStyleSheet()
    normal = ParagraphStyle("ResumeBody", parent=base["Normal"], fontName="Helvetica", fontSize=9.3,
                            leading=12.2, spaceAfter=4, textColor=colors.HexColor("#263247"))
    name_style = ParagraphStyle("ResumeName", parent=base["Title"], fontName="Helvetica-Bold", fontSize=21,
                                leading=25, alignment=TA_CENTER, spaceAfter=7, textColor=colors.HexColor("#172033"))
    heading = ParagraphStyle("ResumeHeading", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=10.5,
                             leading=13, spaceBefore=11, spaceAfter=5, textColor=colors.HexColor("#304a78"),
                             borderPadding=(0, 0, 3, 0))
    contact = ParagraphStyle("ResumeContact", parent=normal, alignment=TA_CENTER, fontSize=8.5, leading=11,
                             textColor=colors.HexColor("#566276"), spaceAfter=4)
    doc = SimpleDocTemplate(out_path, pagesize=LETTER, rightMargin=.68*inch, leftMargin=.68*inch,
                            topMargin=.55*inch, bottomMargin=.55*inch, title="Resume")
    story, bullets, first_content = [], [], True

    def markup(text):
        # Escape HTML-sensitive characters, then support the small Markdown subset used by the editor.
        text = escape(text).replace("&lt;", "&lt;").replace("&gt;", "&gt;")
        import re
        return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)

    def flush():
        nonlocal bullets
        if bullets:
            story.append(ListFlowable([ListItem(Paragraph(markup(item), normal), leftIndent=11) for item in bullets],
                                      bulletType="bullet", start="circle", leftIndent=14, bulletFontName="Helvetica", bulletFontSize=6))
            story.append(Spacer(1, 3))
            bullets = []

    for raw in markdown_text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        if line.startswith(("- ", "* ", "• ")):
            bullets.append(line[2:].strip() if line[1] == " " else line[1:].strip())
            continue
        flush()
        if line.startswith("# "):
            text = line[2:].strip()
            story.append(Paragraph(markup(text), name_style if first_content else heading))
            first_content = False
        elif line.startswith(("## ", "### ")):
            story.append(Paragraph(markup(line.lstrip("#").strip().upper()), heading))
            first_content = False
        elif len(line) < 70 and line.upper() == line and any(c.isalpha() for c in line):
            story.append(Paragraph(markup(line), heading))
            first_content = False
        elif first_content:
            story.append(Paragraph(markup(line), name_style))
            first_content = False
        elif ("@" in line or "linkedin" in line.lower() or "github" in line.lower()) and len(line) < 240:
            story.append(Paragraph(markup(line.replace("|", " · ")), contact))
        else:
            story.append(Paragraph(markup(line.replace("|", " · ")), normal))
    flush()
    doc.build(story)
    return out_path
