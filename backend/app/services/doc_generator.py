"""Document generation service — PDF notes, cheat sheets, PYQ compilations.

Exports:
  generate_notes_pdf(title, content, subject, metadata) -> bytes
  generate_cheat_sheet_pdf(title, points, subject) -> bytes
  generate_pyq_pdf(title, questions, subject, year) -> bytes
"""

from __future__ import annotations

import re
from typing import Any


def _cell_line(pdf: Any, w: float, h: float, text: str, align: str = "L") -> None:
    """Write one line while supporting both fpdf2 and legacy pyfpdf APIs."""
    try:
        pdf.cell(w, h, text, new_x="LMARGIN", new_y="NEXT", align=align)
    except TypeError:
        pdf.cell(w, h, text, ln=True, align=align)


def _pdf_bytes(pdf: Any) -> bytes:
    """Return PDF bytes across fpdf2/pyfpdf output variants."""
    try:
        raw = pdf.output(dest="S")
    except TypeError:
        raw = pdf.output()

    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if isinstance(raw, str):
        return raw.encode("latin-1", errors="replace")
    return bytes(raw)


def _safe_text(text: str) -> str:
    """Replace unsupported characters for FPDF (latin-1 safe)."""
    replacements = {
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "--", "\u2026": "...", "\u2022": "*",
        "\u00b2": "^2", "\u00b3": "^3", "\u2248": "~=", "\u2260": "!=",
        "\u2264": "<=", "\u2265": ">=", "\u221a": "sqrt", "\u03c0": "pi",
        "\u03b1": "alpha", "\u03b2": "beta", "\u03b3": "gamma",
        "\u03b4": "delta", "\u03b8": "theta", "\u03bb": "lambda",
        "\u03bc": "mu", "\u03c3": "sigma", "\u03c9": "omega",
    }
    for char, replacement in replacements.items():
        text = text.replace(char, replacement)
    # Final fallback: encode to latin-1 replacing unknowns
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _strip_markdown(text: str) -> str:
    """Convert basic Markdown to plain text for PDF rendering."""
    # Remove headers (keep text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Bold/italic → plain
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"_(.+?)_", r"\1", text)
    # Code blocks
    text = re.sub(r"```[\s\S]*?```", lambda m: m.group().strip("`").strip(), text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    # Links [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text


def generate_notes_pdf(
    title: str,
    content: str,
    subject: str = "",
    metadata: dict[str, str] | None = None,
) -> bytes:
    """Generate a structured notes PDF from Markdown content."""
    try:
        from fpdf import FPDF  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("fpdf2 package not installed. Run: pip install fpdf2")

    pdf: Any = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Credon branded header
    pdf.set_fill_color(7, 20, 30)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    try:
        pdf.cell(0, 9, "CREDON AI", border=0, ln=True, align="C", fill=True)
    except TypeError:
        pdf.cell(0, 9, "CREDON AI", border=0, new_x="LMARGIN", new_y="NEXT", align="C", fill=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    # Title
    pdf.set_font("Helvetica", "B", 18)
    _cell_line(pdf, 0, 12, _safe_text(title), align="C")
    pdf.ln(2)

    # Subject + metadata
    if subject or metadata:
        pdf.set_font("Helvetica", "I", 10)
        meta_parts: list[str] = []
        if subject:
            meta_parts.append(f"Subject: {subject.title()}")
        if metadata:
            for key, val in metadata.items():
                if val:
                    meta_parts.append(f"{key.title()}: {val}")
        _cell_line(pdf, 0, 8, _safe_text(" | ".join(meta_parts)), align="C")
        pdf.ln(4)

    # Divider
    pdf.set_draw_color(100, 100, 100)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    # Content — parse Markdown sections
    clean = _strip_markdown(content)
    lines = clean.split("\n")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            pdf.ln(3)
            continue

        # Detect bullet points
        if stripped.startswith(("- ", "* ", "• ")):
            pdf.set_font("Helvetica", "", 11)
            pdf.set_x(pdf.l_margin + 6)
            pdf.multi_cell(w=pdf.w - pdf.l_margin - pdf.r_margin - 6, h=6, text=_safe_text(f"\u2022 {stripped[2:]}"))
        elif stripped.startswith(tuple(f"{i}." for i in range(1, 100))):
            pdf.set_font("Helvetica", "", 11)
            pdf.set_x(pdf.l_margin + 6)
            pdf.multi_cell(w=pdf.w - pdf.l_margin - pdf.r_margin - 6, h=6, text=_safe_text(stripped))
        else:
            # Check if it looks like a heading (short, no period)
            if len(stripped) < 80 and not stripped.endswith((".", ",", ";")):
                pdf.set_font("Helvetica", "B", 13)
                pdf.ln(3)
                pdf.multi_cell(0, 7, _safe_text(stripped))
                pdf.ln(1)
            else:
                pdf.set_font("Helvetica", "", 11)
                pdf.multi_cell(0, 6, _safe_text(stripped))

    # Footer
    pdf.ln(10)
    pdf.set_draw_color(34, 211, 238)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 8)
    _cell_line(pdf, 0, 6, "Generated by Credon AI | (c) 2026 CredonAI. Educational use only.", align="C")

    return _pdf_bytes(pdf)


def generate_cheat_sheet_pdf(
    title: str,
    points: list[str],
    subject: str = "",
) -> bytes:
    """Generate a compact cheat sheet PDF with key points."""
    try:
        from fpdf import FPDF  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("fpdf2 package not installed. Run: pip install fpdf2")

    pdf: Any = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Header
    pdf.set_font("Helvetica", "B", 16)
    _cell_line(pdf, 0, 10, _safe_text(f"Cheat Sheet: {title}"), align="C")
    if subject:
        pdf.set_font("Helvetica", "I", 10)
        _cell_line(pdf, 0, 6, _safe_text(f"Subject: {subject.title()}"), align="C")
    pdf.ln(4)

    pdf.set_draw_color(0, 150, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)

    # Points in compact format
    pdf.set_font("Helvetica", "", 10)
    for i, point in enumerate(points, 1):
        clean_point = _strip_markdown(point).strip()
        if not clean_point:
            continue
        pdf.set_font("Helvetica", "B", 10)
        num_w = 10
        pdf.cell(num_w, 5, f"{i}.")
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(w=pdf.w - pdf.l_margin - pdf.r_margin - num_w, h=5, text=_safe_text(clean_point))
        pdf.ln(1.5)

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    _cell_line(pdf, 0, 5, "Generated by Credon AI", align="C")

    return _pdf_bytes(pdf)


def generate_pyq_pdf(
    title: str,
    questions: list[dict[str, Any]],
    subject: str = "",
    year: str = "",
) -> bytes:
    """Generate a previous year questions compilation PDF.
    
    Each question dict: {"question": str, "marks": int|str, "year": str, "answer": str (optional)}
    """
    try:
        from fpdf import FPDF  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("fpdf2 package not installed. Run: pip install fpdf2")

    pdf: Any = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Header
    pdf.set_font("Helvetica", "B", 16)
    _cell_line(pdf, 0, 10, _safe_text(title), align="C")
    meta: list[str] = []
    if subject:
        meta.append(f"Subject: {subject.title()}")
    if year:
        meta.append(f"Year: {year}")
    if meta:
        pdf.set_font("Helvetica", "I", 10)
        _cell_line(pdf, 0, 6, _safe_text(" | ".join(meta)), align="C")
    pdf.ln(4)
    pdf.set_draw_color(0, 150, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    for i, q in enumerate(questions, 1):
        question_text = q.get("question", "").strip()
        marks = q.get("marks", "")
        q_year = q.get("year", "")
        answer = q.get("answer", "").strip()

        if not question_text:
            continue

        # Question
        pdf.set_font("Helvetica", "B", 11)
        marks_str = f" [{marks} marks]" if marks else ""
        year_str = f" ({q_year})" if q_year else ""
        pdf.multi_cell(0, 6, _safe_text(f"Q{i}.{marks_str}{year_str} {_strip_markdown(question_text)}"))

        # Answer (if provided)
        if answer:
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(60, 60, 60)
            pdf.multi_cell(0, 5, _safe_text(f"Ans: {_strip_markdown(answer)}"))
            pdf.set_text_color(0, 0, 0)

        pdf.ln(4)

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    _cell_line(pdf, 0, 5, "Generated by Credon AI", align="C")

    return _pdf_bytes(pdf)
