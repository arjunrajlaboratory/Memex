#!/usr/bin/env python3
"""
Merge letter markdown into the Example Lab letterhead template (`test_letterhead.docx`).

Canonical template (with `[body]` placeholder, signature image, name/titles):
    Google Drive: recommendation_letters/AI training sets/test_letterhead.docx
    Drive Desktop path: ~/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/
                        recommendation_letters/AI training sets/test_letterhead.docx

Template structure (21 paragraphs):
    0-10: letterhead — logo image, blank, institutional address (8 lines), blank
    11:   `[body]` PLACEHOLDER  <-- replaced by this script
    12:   blank
    13:   "Sincerely,"
    14:   signature image
    15:   blank
    16-19: {{OWNER_NAME}} + titles (4 lines)
    20:   blank

This script preserves paragraphs 0-10 and 12+ and replaces paragraph 11
with the new letter's date + Re: line + body paragraphs (one <w:p> each,
separated by styled blank paragraphs).

Input letter markdown is expected to contain:
    [institutional header at top — STRIPPED, template provides it]
    [blank]
    Month DD, YYYY              <-- detected as the body-start marker
    [blank]
    Re: <subject>
    [blank]
    <body paragraphs separated by blank lines>
    [blank]
    Sincerely,                  <-- detected as the body-end marker
    [signature lines below — STRIPPED, template provides them]

Italic markers `*foo*` become italic runs in the output docx.

Usage:
    python3 scripts/merge_letterhead.py \\
        --template outputs/letters/_template/test_letterhead.docx \\
        --letter   /tmp/alex-kim-md-2026.md \\
        --output   "outputs/letters/Alex Kim - MD 2026.docx"

Stdlib only — no python-docx dependency.
"""

import argparse
import re
import zipfile
from pathlib import Path

DATE_PATTERN = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$"
)
SINCERELY_PATTERN = re.compile(r"^Sincerely,?\s*$")
BODY_PLACEHOLDER = "[body]"


def extract_letter_body(md_text: str) -> list[str]:
    """Pull date + Re: + body paragraphs out of the letter markdown.

    Skips institutional header at top (lines before the date) and signature
    block at bottom (everything from "Sincerely," onward).
    """
    lines = md_text.split("\n")
    start = next((i for i, ln in enumerate(lines) if DATE_PATTERN.match(ln.strip())), None)
    if start is None:
        raise ValueError("No date line found (expected 'Month DD, YYYY' between the institutional header and Re: line).")
    end = next((i for i in range(start, len(lines)) if SINCERELY_PATTERN.match(lines[i].strip())), len(lines))
    body_block = "\n".join(lines[start:end]).strip()
    return [p.strip() for p in re.split(r"\n\s*\n", body_block) if p.strip()]


def xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def runs_for_text(text: str) -> list[tuple[str, bool]]:
    """Split on `*italic*` markers. Returns [(segment, is_italic), ...]."""
    parts: list[tuple[str, bool]] = []
    pos = 0
    for m in re.finditer(r"\*([^*]+)\*", text):
        if m.start() > pos:
            parts.append((text[pos : m.start()], False))
        parts.append((m.group(1), True))
        pos = m.end()
    if pos < len(text):
        parts.append((text[pos:], False))
    if not parts:
        parts.append((text, False))
    return parts


def extract_block(xml: str, pattern: str) -> str:
    m = re.search(pattern, xml, re.DOTALL)
    return m.group(0) if m else ""


def build_paragraph(text: str, style_p: str) -> str:
    """Build a <w:p> with `text`, copying paragraph + run styling from `style_p`."""
    ppr = extract_block(style_p, r"<w:pPr>.*?</w:pPr>")
    rpr_match = re.search(r"<w:r\b[^>]*>\s*(<w:rPr>.*?</w:rPr>)", style_p, re.DOTALL)
    base_rpr = rpr_match.group(1) if rpr_match else ""

    runs_xml = ""
    for segment, is_italic in runs_for_text(text):
        if is_italic and base_rpr:
            this_rpr = (
                base_rpr if "<w:i/>" in base_rpr else base_rpr.replace("</w:rPr>", "<w:i/></w:rPr>", 1)
            )
        elif is_italic:
            this_rpr = "<w:rPr><w:i/></w:rPr>"
        else:
            this_rpr = base_rpr
        runs_xml += f'<w:r>{this_rpr}<w:t xml:space="preserve">{xml_escape(segment)}</w:t></w:r>'

    return f"<w:p>{ppr}{runs_xml}</w:p>"


def build_blank(style_p: str) -> str:
    """Blank paragraph matching the styling of `style_p`."""
    ppr = extract_block(style_p, r"<w:pPr>.*?</w:pPr>")
    return f"<w:p>{ppr}</w:p>"


def find_placeholder_index(paragraphs: list[str]) -> int:
    """Return the index of the paragraph containing `[body]`."""
    for i, p in enumerate(paragraphs):
        if BODY_PLACEHOLDER in p:
            return i
    raise ValueError(
        f"No '{BODY_PLACEHOLDER}' placeholder paragraph in the template. "
        "Are you sure you're using the AI-training-sets canonical template?"
    )


def merge(template: Path, letter: Path, output: Path) -> None:
    body_paragraphs = extract_letter_body(letter.read_text())

    with zipfile.ZipFile(template) as z:
        doc_xml = z.read("word/document.xml").decode("utf-8")
        other_files = {n: z.read(n) for n in z.namelist() if n != "word/document.xml"}

    paragraphs = re.findall(r"<w:p\b[^>]*>.*?</w:p>", doc_xml, re.DOTALL)
    placeholder_idx = find_placeholder_index(paragraphs)

    keep_start = paragraphs[:placeholder_idx]
    placeholder_p = paragraphs[placeholder_idx]
    keep_end = paragraphs[placeholder_idx + 1 :]

    # Pick a blank paragraph from the kept prefix to use as the styled separator;
    # fall back to the placeholder's own style if no blank exists.
    blank_style = next(
        (p for p in reversed(keep_start) if not re.search(r"<w:t[^>]*>[^<]+</w:t>", p)),
        placeholder_p,
    )

    new_body: list[str] = []
    for i, para in enumerate(body_paragraphs):
        new_body.append(build_paragraph(para, placeholder_p))
        if i < len(body_paragraphs) - 1:
            new_body.append(build_blank(blank_style))

    body_match = re.search(r"(<w:body>)(.*?)(</w:body>)", doc_xml, re.DOTALL)
    if not body_match:
        raise ValueError("Could not locate <w:body> in document.xml")
    inner = body_match.group(2)
    sectpr = extract_block(inner, r"<w:sectPr\b.*?</w:sectPr>")
    new_inner = "".join(keep_start + new_body + keep_end) + sectpr

    new_doc_xml = doc_xml[: body_match.start(2)] + new_inner + doc_xml[body_match.end(2) :]

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in other_files.items():
            z.writestr(name, data)
        z.writestr("word/document.xml", new_doc_xml.encode("utf-8"))
    print(
        f"Wrote {output} "
        f"({output.stat().st_size} bytes, "
        f"replaced 1 placeholder paragraph with {len(body_paragraphs)} body paragraphs)"
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--template", required=True, type=Path)
    ap.add_argument("--letter", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()
    merge(args.template, args.letter, args.output)
